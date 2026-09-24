import type { Config, Context } from '@netlify/functions';
import https from 'node:https';
import type { PokemonIndexData, PokemonProductEntry } from '../../src/lib/catalog/types.js';
import { extractTokens, normalizeText, normalizeUpc } from '../../src/lib/catalog/utils.js';
import { savePokemonIndex } from '../../src/lib/catalog/pokemon-store.js';

const TCGCSV_BASE = 'https://tcgcsv.com';

// Job programado diario (Netlify Scheduled Function)
export const config: Config = {
  schedule: '@daily',
};

const SEALED_KEYWORDS = [
  'box',
  'collection',
  'tin',
  'booster',
  'bundle',
  'case',
  'binder',
  'poster',
  'sticker',
  'deck',
  'blister',
  'chest',
  'pin',
  'pack',
  'display',
  'etb',
  'portfolio',
  'elite trainer',
  'battle stadium',
  'build & battle',
];

function fetchJson<T = any>(url: string, retries = 3): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': 'evo-catalog/1.0 (contacto@evo.cl)',
          Accept: 'application/json',
        },
        timeout: 15000,
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          if (retries > 0) {
            setTimeout(() => {
              fetchJson<T>(url, retries - 1).then(resolve).catch(reject);
            }, 1000);
            return;
          }
          return reject(new Error(`HTTP ${res.statusCode} para ${url}`));
        }

        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            if (retries > 0) {
              setTimeout(() => {
                fetchJson<T>(url, retries - 1).then(resolve).catch(reject);
              }, 1000);
            } else {
              reject(err);
            }
          }
        });
      }
    );

    req.on('error', (err) => {
      if (retries > 0) {
        setTimeout(() => {
          fetchJson<T>(url, retries - 1).then(resolve).catch(reject);
        }, 1000);
      } else {
        reject(err);
      }
    });

    req.on('timeout', () => {
      req.destroy();
      if (retries > 0) {
        setTimeout(() => {
          fetchJson<T>(url, retries - 1).then(resolve).catch(reject);
        }, 1000);
      } else {
        reject(new Error(`Timeout en ${url}`));
      }
    });
  });
}

export function isSealedProduct(productName: string, extendedData?: Array<{ name: string; value: string }>): boolean {
  if (!productName) return false;
  if (productName.startsWith('Code Card')) return false;

  // Si tiene UPC explícito en extendedData, es sellado
  const hasUpc = extendedData?.some((e) => e.name === 'UPC' && e.value && e.value.trim().length > 0);
  if (hasUpc) return true;

  // Descartar cartas sueltas con patrones de numeración (ej. "8/102", "69/98", "023/128", "(29 - Suicune Deck)")
  if (/\b\d{1,4}\s*\/\s*\d{1,4}\b/.test(productName)) {
    return false;
  }
  if (/\(\s*\d{1,4}\s*-\s*[^\)]+\)/.test(productName)) {
    return false;
  }
  if (/\b(?:Secret|Ultra|Illustration|Special Illustration|Hyper|Trainer Gallery)\s+Rare\b/i.test(productName)) {
    return false;
  }

  const lower = productName.toLowerCase();

  // Verificar palabras clave estrictas de sellado
  return SEALED_KEYWORDS.some((kw) => {
    const regex = new RegExp(`\\b${kw}\\b`, 'i');
    return regex.test(lower);
  });
}

function cleanDescription(rawDesc?: string): string | undefined {
  if (!rawDesc) return undefined;
  const clean = rawDesc
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?[^>]+(>|$)/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();
  return clean.length > 0 ? clean : undefined;
}

export async function buildPokemonIndex(): Promise<PokemonIndexData> {
  const startTime = Date.now();
  console.log('[pokemon-index] Iniciando reconstrucción del índice Pokémon TCG...');

  // 1. Confirmar categoría Pokémon
  const categoriesRes = await fetchJson(`${TCGCSV_BASE}/tcgplayer/categories`);
  const pokemonCat = categoriesRes.results?.find(
    (c: any) => c.categoryId === 3 || c.name?.toLowerCase() === 'pokemon'
  );
  const categoryId = pokemonCat ? pokemonCat.categoryId : 3;
  console.log(`[pokemon-index] Categoría Pokémon confirmada: ID ${categoryId}`);

  // 2. Obtener lista de grupos
  const groupsRes = await fetchJson(`${TCGCSV_BASE}/tcgplayer/${categoryId}/groups`);
  const groups: Array<{ groupId: number; name: string }> = groupsRes.results || [];
  console.log(`[pokemon-index] Se encontraron ${groups.length} grupos en TCGCSV`);

  // Ordenar grupos de forma deterministica
  groups.sort((a, b) => a.groupId - b.groupId);

  const byUpcMap: Record<string, number[]> = {};
  const allProductsMap = new Map<number, PokemonProductEntry>();

  // 3. Descargar productos en lotes concurrentes (10 en paralelo)
  const CONCURRENCY = 10;
  for (let i = 0; i < groups.length; i += CONCURRENCY) {
    const batch = groups.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (group) => {
        try {
          const prodsRes = await fetchJson(`${TCGCSV_BASE}/tcgplayer/${categoryId}/${group.groupId}/products`);
          const rawProducts = prodsRes.results || [];

          for (const p of rawProducts) {
            if (!isSealedProduct(p.name, p.extendedData)) {
              continue;
            }

            const rawUpc = p.extendedData?.find((e: any) => e.name === 'UPC')?.value || '';
            const normalizedU = normalizeUpc(rawUpc);
            const normTitle = normalizeText(p.name);
            const tokens = extractTokens(p.name);
            const rawDesc = p.extendedData?.find((e: any) => e.name === 'CardText')?.value;
            const desc = cleanDescription(rawDesc);

            const entry: PokemonProductEntry = {
              productId: p.productId,
              name: p.name,
              cleanName: p.cleanName || p.name,
              normalizedTitle: normTitle,
              tokens,
              groupId: group.groupId,
              groupName: group.name,
              upc: normalizedU || undefined,
              imageUrl: p.imageUrl || `https://tcgplayer-cdn.tcgplayer.com/product/${p.productId}_200w.jpg`,
              url: p.url || '',
              releasedOn: p.presaleInfo?.releasedOn || undefined,
              description: desc,
            };

            allProductsMap.set(p.productId, entry);

            if (normalizedU) {
              if (!byUpcMap[normalizedU]) {
                byUpcMap[normalizedU] = [];
              }
              if (!byUpcMap[normalizedU].includes(p.productId)) {
                byUpcMap[normalizedU].push(p.productId);
              }
            }
          }
        } catch (err) {
          console.warn(`[pokemon-index] Error al descargar grupo ${group.groupId} (${group.name}):`, err);
        }
      })
    );
  }

  // 4. Ordenar determinísticamente todos los productos y mapas
  const sortedProducts = Array.from(allProductsMap.values()).sort((a, b) => a.productId - b.productId);

  // Ordenar determinísticamente las claves de byUpc y sus arreglos de IDs
  const sortedByUpc: Record<string, number[]> = {};
  const sortedUpcKeys = Object.keys(byUpcMap).sort();
  for (const key of sortedUpcKeys) {
    sortedByUpc[key] = byUpcMap[key].sort((a, b) => a - b);
  }

  const indexData: PokemonIndexData = {
    version: '1.0.0',
    generatedAt: new Date().toISOString(),
    totalProducts: sortedProducts.length,
    byUpc: sortedByUpc,
    products: sortedProducts,
  };

  // Guardar en Blobs y local
  await savePokemonIndex(indexData);

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(
    `[pokemon-index] Índice completado en ${durationSec}s: ${sortedProducts.length} productos sellados, ${sortedUpcKeys.length} códigos UPC indexados.`
  );

  return indexData;
}

// Handler de invocación programada en Netlify
export default async (req: Request, context: Context) => {
  try {
    const indexData = await buildPokemonIndex();
    return new Response(
      JSON.stringify({
        status: 'success',
        totalProducts: indexData.totalProducts,
        upcCount: Object.keys(indexData.byUpc).length,
        version: indexData.version,
        generatedAt: indexData.generatedAt,
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        status: 'error',
        message: (err as Error).message,
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
};
