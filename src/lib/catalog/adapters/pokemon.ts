import https from 'node:https';
import type {
  CatalogAdapter,
  CatalogItem,
  FieldSpec,
  ParsedInput,
  PokemonIndexData,
  PokemonProductEntry,
} from '../types.js';
import {
  calculateJaccard,
  extractProductTypeAndVariant,
  extractTokens,
  normalizeText,
  normalizeUpc,
} from '../utils.js';
import { loadPokemonIndex } from '../pokemon-store.js';
import { POKEMON_FIELDS } from './pokemon-spec.js';

function fetchUrl(url: string, headers: Record<string, string> = {}): Promise<{ status: number; data: string }> {
  return new Promise((resolve) => {
    const defaultHeaders = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 evo.cl/1.0',
      Accept: 'application/json, text/html, */*; q=0.9',
      'Accept-Language': 'es-CL,es;q=0.9,en;q=0.8',
      ...headers,
    };

    const req = https.get(url, { headers: defaultHeaders, timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode || 200, data }));
    });

    req.on('error', (err) => resolve({ status: 500, data: err.message }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: 408, data: 'Timeout' });
    });
  });
}

async function translateChunk(chunk: string): Promise<string> {
  if (!chunk.trim()) return '';
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=es&dt=t&q=${encodeURIComponent(chunk.trim())}`;
    const res = await fetchUrl(url);
    if (res.status === 200 && res.data) {
      const json = JSON.parse(res.data);
      if (Array.isArray(json) && Array.isArray(json[0])) {
        return json[0].map((part: any) => part[0]).join('');
      }
    }
  } catch (err) {
    console.warn('[pokemon-adapter] Error en traducción:', err);
  }
  return chunk;
}

async function translateToSpanish(text: string): Promise<string> {
  if (!text || text.trim().length === 0) return '';
  const clean = text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?[^>]+(>|$)/g, ' ')
    .trim();

  if (!clean) return '';

  const paragraphs = clean.split('\n').map((p) => p.trim()).filter(Boolean);
  const translated = await Promise.all(paragraphs.map((p) => translateChunk(p)));
  return translated.join('\n\n');
}

interface ShopifyEnrichment {
  enriched: boolean;
  descriptionEs?: string;
  extraImages: string[];
  shopifyUrl?: string;
  matchedTitle?: string;
  rejectionReason?: string;
}

const FOREIGN_LANG_MARKERS = [
  'chino',
  'chinese',
  'japones',
  'japanese',
  'coreano',
  'korean',
  'ingles',
  'english',
];

// Tabla de sinónimos canónicos bilingües
const BILINGUAL_SYNONYMS: Record<string, string> = {
  celebration: 'celeb',
  celebrations: 'celeb',
  celebraciones: 'celeb',
  celebracion: 'celeb',
  anniversary: 'aniv',
  aniversario: 'aniv',
  box: 'box',
  caja: 'box',
  sticker: 'stk',
  stickers: 'stk',
  pegatina: 'stk',
  pegatinas: 'stk',
  '30th': '30',
  '30': '30',
  elite: 'elite',
  etb: 'elite',
  poster: 'poster',
  posters: 'poster',
  collection: 'coll',
  coleccion: 'coll',
  blister: 'blister',
  tin: 'tin',
  lata: 'tin',
  binder: 'binder',
  album: 'binder',
};

function normalizeBilingualToken(token: string): string {
  return BILINGUAL_SYNONYMS[token] || token;
}

export function verifyShopifyMatch(
  sourceName: string,
  candidateTitle: string,
  variant?: string,
  productType?: string,
  groupName?: string
): { valid: boolean; reason?: string; score: number } {
  const normCandidate = normalizeText(candidateTitle);
  const candTokens = extractTokens(candidateTitle);
  const sourceTokens = extractTokens(sourceName);
  const candSet = new Set(candTokens);

  // 1. Rechazar candidatos con marcadores de otros idiomas comparando contra el título completo
  for (const marker of FOREIGN_LANG_MARKERS) {
    const regex = new RegExp(`\\b${marker}\\b`, 'i');
    if (regex.test(normCandidate)) {
      return { valid: false, reason: `Idioma incompatible (${marker})`, score: 0 };
    }
  }

  // 2. Validación de tipo de producto
  if (productType) {
    const pTypeLower = productType.toLowerCase();

    // Si es "ex Box", rechazar Tins/Latas o Blísters
    if (pTypeLower.includes('box')) {
      if (candSet.has('tin') || candSet.has('lata') || (candSet.has('blister') && !candSet.has('box') && !candSet.has('caja'))) {
        return { valid: false, reason: 'Tipo de producto incompatible (esperado Box, recibido Tin/Lata/Blíster)', score: 0 };
      }
    }

    // Si es "Poster Collection", exigir mención de póster / poster y rechazar blísters sueltos
    if (pTypeLower.includes('poster')) {
      if (!candSet.has('poster')) {
        return { valid: false, reason: 'Falta término Poster', score: 0 };
      }
    }

    // Si es "Elite Trainer Box", exigir ETB o Elite Trainer Box y rechazar album collection
    if (pTypeLower.includes('elite trainer')) {
      const isEtb = candSet.has('etb') || (candSet.has('elite') && candSet.has('trainer'));
      if (!isEtb) {
        return { valid: false, reason: 'Falta término ETB / Elite Trainer Box', score: 0 };
      }
    }

    // Si es "Tech Sticker", exigir sticker / pegatina
    if (pTypeLower.includes('sticker')) {
      if (!candSet.has('sticker') && !candSet.has('stickers') && !candSet.has('pegatina') && !candSet.has('pegatinas')) {
        return { valid: false, reason: 'Falta término Sticker', score: 0 };
      }
    }
  }

  // 3. Validación de variante/personaje
  if (variant) {
    const varTokens = extractTokens(variant);
    const hasVariant = varTokens.some((vt) => candSet.has(vt));
    if (!hasVariant) {
      return { valid: false, reason: `Variante no coincide (esperado ${variant})`, score: 0 };
    }
  }

  // 4. Validación de expansión / colección usando groupName
  if (groupName) {
    const EXP_CODE_REGEX = /^(me\d*|sv\d*|swsh\d*|sm\d*|xy\d*|bw\d*|dp\d*|ex\d*|promo)$/i;
    const expTokens = extractTokens(groupName).filter((t) => !EXP_CODE_REGEX.test(t));
    if (expTokens.length > 0) {
      const canonicalExp = new Set(expTokens.map(normalizeBilingualToken));
      const canonicalCand = new Set(candTokens.map(normalizeBilingualToken));
      let matchesExp = false;
      for (const t of canonicalExp) {
        if (canonicalCand.has(t)) {
          matchesExp = true;
          break;
        }
      }
      if (!matchesExp) {
        return { valid: false, reason: `Expansión no coincide con "${groupName}"`, score: 0 };
      }
    }
  }

  // 5. Similitud considerando sinónimos bilingües canónicos
  const normalizedSourceTokens = sourceTokens.map(normalizeBilingualToken);
  const normalizedCandTokens = candTokens.map(normalizeBilingualToken);

  const score = calculateJaccard(normalizedSourceTokens, normalizedCandTokens);
  if (score < 0.35) {
    return { valid: false, reason: `Similitud Jaccard insuficiente (${score.toFixed(2)})`, score };
  }

  return { valid: true, score };
}

async function searchShopifySpanishStore(
  storeDomain: string,
  sourceName: string,
  variant?: string,
  productType?: string,
  groupName?: string
): Promise<ShopifyEnrichment | null> {
  try {
    const cleanSearch = sourceName
      .replace(/pokemon|tcg|cartas|juego/gi, '')
      .replace(/[-|]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const url = `https://${storeDomain}/search/suggest.json?q=${encodeURIComponent(cleanSearch)}&resources[type]=product&resources[options][unavailable_products]=show`;
    const res = await fetchUrl(url);
    if (res.status !== 200 || !res.data) return null;

    const json = JSON.parse(res.data);
    const products = json.resources?.results?.products;
    if (!products || !Array.isArray(products) || products.length === 0) return null;

    // Evaluar candidatos con verifyShopifyMatch
    for (const prod of products) {
      const verification = verifyShopifyMatch(sourceName, prod.title, variant, productType, groupName);
      if (!verification.valid) {
        continue;
      }

      // Candidato verificado
      const handle = prod.handle;
      const extraImages: string[] = [];
      let descriptionEs: string | undefined = prod.body;

      if (prod.image) {
        extraImages.push(prod.image.replace(/_small|_medium|_large|_compact/g, ''));
      }

      if (handle) {
        const prodRes = await fetchUrl(`https://${storeDomain}/products/${handle}.json`);
        if (prodRes.status === 200 && prodRes.data) {
          const prodJson = JSON.parse(prodRes.data);
          const p = prodJson.product;
          if (p) {
            if (p.body_html) {
              descriptionEs = p.body_html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            }
            if (Array.isArray(p.images)) {
              p.images.forEach((img: any) => {
                if (img.src && !extraImages.includes(img.src)) {
                  extraImages.push(img.src);
                }
              });
            }
          }
        }
      }

      return {
        enriched: true,
        descriptionEs,
        extraImages,
        shopifyUrl: `https://${storeDomain}/products/${handle || ''}`,
        matchedTitle: prod.title,
      };
    }

    return null;
  } catch {
    return null;
  }
}

async function enrichSpanishDetails(
  sourceName: string,
  variant?: string,
  productType?: string,
  groupName?: string
): Promise<ShopifyEnrichment> {
  const pokemillonResult = await searchShopifySpanishStore('pokemillon.com', sourceName, variant, productType, groupName);
  if (pokemillonResult && pokemillonResult.enriched) {
    return pokemillonResult;
  }

  const todohitsResult = await searchShopifySpanishStore('todohits.com', sourceName, variant, productType, groupName);
  if (todohitsResult && todohitsResult.enriched) {
    return todohitsResult;
  }

  return { enriched: false, extraImages: [] };
}

export const pokemonAdapter: CatalogAdapter = {
  id: 'pokemon',
  label: 'Pokémon TCG',
  fields: POKEMON_FIELDS,


  detect(input: string): number {
    if (!input) return 0;
    const lower = input.toLowerCase();

    // Prefijo UPC habitual de Pokémon (196214)
    if (/\b196214\d{6}\b/.test(input) || /\b0196214\d{6}\b/.test(input)) {
      return 0.95;
    }

    if (lower.includes('pokemon') || lower.includes('pokémon')) {
      return 0.9;
    }

    if (
      lower.includes('tcg') ||
      lower.includes('elite trainer box') ||
      lower.includes('booster bundle') ||
      lower.includes('booster pack') ||
      lower.includes('tech sticker') ||
      lower.includes('poster collection')
    ) {
      return 0.85;
    }

    return 0;
  },

  parseInput(raw: string): ParsedInput {
    const cleanRaw = (raw || '').trim();
    let upc: string | undefined;
    let price: string | undefined;
    let language: 'EN' | 'ES' | undefined;
    let title: string | undefined;

    // Detectar idioma (sin confundir la preposición "en")
    if (/español|espanol|\b(es)\b/i.test(cleanRaw)) {
      language = 'ES';
    } else if (/english|ingles|\benglish\b/i.test(cleanRaw)) {
      language = 'EN';
    }

    // Detectar precio ($XX.XXX o $XX,XX)
    const priceMatch = cleanRaw.match(/\$\s*[\d\.\,]+/);
    if (priceMatch) {
      price = priceMatch[0].trim();
    }

    // Detectar UPC (12 o 13 dígitos numéricos)
    const upcMatch = cleanRaw.match(/\b\d{12,13}\b/);
    if (upcMatch) {
      upc = upcMatch[0];
    }

    let textWithoutUpcPrice = cleanRaw;
    if (upc) {
      textWithoutUpcPrice = textWithoutUpcPrice.replace(upc, ' ');
    }
    if (price) {
      textWithoutUpcPrice = textWithoutUpcPrice.replace(price, ' ');
    }

    const parts = cleanRaw.split('|').map((p) => p.trim());
    if (parts.length >= 2) {
      for (const part of parts) {
        if (part !== upc && part !== price && part.length > 3) {
          title = part;
          break;
        }
      }
    }

    if (!title) {
      title = textWithoutUpcPrice
        .replace(/[\|\-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    return {
      raw: cleanRaw,
      upc,
      title,
      price,
      sku: upc,
      language,
    };
  },

  async lookup(p: ParsedInput): Promise<CatalogItem | CatalogItem[]> {
    const index = await loadPokemonIndex();
    if (!index) {
      return {
        query: p.raw,
        upc: p.upc || '',
        productId: 0,
        title: p.title || p.raw,
        image: '',
        gallery: [],
        source: 'not_found',
        status: 'error',
        diagnosis: 'El índice local de Pokémon no está disponible. Ejecute el job pokemon-index primero.',
      };
    }

    const normUpc = normalizeUpc(p.upc || '');
    let matchedEntries: Array<{
      entry: PokemonProductEntry;
      score: number;
      matchType: 'upc_exact' | 'title_normalized' | 'title_jaccard';
    }> = [];

    // 1. Búsqueda por UPC exacto en byUpc
    if (normUpc && index.byUpc && index.byUpc[normUpc] && index.byUpc[normUpc].length > 0) {
      const candidateIds = index.byUpc[normUpc];
      const candidates = candidateIds
        .map((id) => (index.byId ? index.byId[id] : index.products.find((prod) => prod.productId === id)))
        .filter(Boolean) as PokemonProductEntry[];

      const inputTokens = extractTokens(p.title || p.raw);

      if (candidates.length === 1) {
        matchedEntries = [
          {
            entry: candidates[0],
            score: 1.0,
            matchType: 'upc_exact',
          },
        ];
      } else {
        // Múltiples candidatos que comparten el mismo UPC
        matchedEntries = candidates.map((c) => {
          let score = calculateJaccard(inputTokens, c.tokens);
          return {
            entry: c,
            score,
            matchType: 'upc_exact' as const,
          };
        });

        matchedEntries.sort((a, b) => b.score - a.score);
      }
    }

    // 2. Si no hubo match por UPC, búsqueda por título normalizado con similitud Jaccard
    if (matchedEntries.length === 0 && (p.title || p.raw)) {
      const inputTokens = extractTokens(p.title || p.raw);
      const inputSet = new Set(inputTokens);

      if (inputTokens.length > 0) {
        const scored = index.products
          .map((prod) => {
            let score = calculateJaccard(inputTokens, prod.tokens);
            const prodSet = new Set(prod.tokens);

            // Penalizaciones de reglas de negocio para Pokémon
            if (prodSet.has('case') && !inputSet.has('case')) {
              score -= 0.2;
            }
            if (prodSet.has('center') && !inputSet.has('center')) {
              score -= 0.05;
            }

            return {
              entry: prod,
              score: Math.max(0, score),
              matchType: 'title_jaccard' as const,
            };
          })
          .filter((item) => item.score >= 0.45);

        scored.sort((a, b) => b.score - a.score);

        if (scored.length > 0) {
          const topScore = scored[0].score;
          // Si el topScore es 1.0 (exacto) y supera al segundo por margen claro, resolver directo como candidato único
          if (topScore >= 1.0 && (scored.length === 1 || scored[1].score < 1.0)) {
            matchedEntries = [scored[0]];
          } else {
            // Retornar los candidatos superiores dentro del margen de 0.14 para incluir todas las variantes
            matchedEntries = scored.filter((item) => item.score >= topScore - 0.14).slice(0, 5);
          }
        }
      }
    }

    // 3. Si no hay coincidencias, retornar not_found con diagnóstico
    if (matchedEntries.length === 0) {
      return {
        query: p.raw,
        upc: p.upc || '',
        productId: 0,
        title: p.title || p.raw,
        image: '',
        gallery: [],
        source: 'not_found',
        status: 'not_found',
        diagnosis: `No se encontraron coincidencias para UPC: "${p.upc || ''}" ni título: "${p.title || p.raw}".`,
      };
    }

    // 4. Transformar entradas a CatalogItem y enriquecer
    const isSpanishSearch = p.language === 'ES' || /español|espanol/i.test(p.raw || '');

    const items: CatalogItem[] = await Promise.all(
      matchedEntries.map(async (match, idx) => {
        const entry = match.entry;
        const { productType, variant } = extractProductTypeAndVariant(entry.name);
        const hdImage = `https://tcgplayer-cdn.tcgplayer.com/product/${entry.productId}_in_1000x1000.jpg`;
        const gallery = [hdImage];

        let description = entry.description || '';
        let descriptionEs = '';
        let titleEs = entry.name;
        let source: CatalogItem['source'] = 'tcgcsv';

        // Solo intentar enriquecimiento Shopify para el candidato top (idx === 0) o si hay candidato único
        if (isSpanishSearch && idx === 0) {
          const enrichment = await enrichSpanishDetails(entry.name, variant, productType, entry.groupName);
          if (enrichment.enriched && enrichment.descriptionEs) {
            descriptionEs = enrichment.descriptionEs;
            source = 'shopify_es';
          }
          if (enrichment.enriched && enrichment.extraImages && enrichment.extraImages.length > 0) {
            enrichment.extraImages.forEach((img) => {
              if (!gallery.includes(img)) {
                gallery.push(img);
              }
            });
          }
        }

        // Si no se enriqueció por Shopify pero tenemos descripción en inglés, traducir con fallback
        if (!descriptionEs && description) {
          descriptionEs = await translateToSpanish(description);
          if (source !== 'shopify_es') {
            source = 'translated';
          }
        }

        return {
          query: p.raw,
          upc: p.upc || entry.upc || '',
          productId: entry.productId,
          sku: p.sku || p.upc,
          title: entry.name,
          titleEs,
          expansion: entry.groupName,
          productType,
          variant,
          language: p.language || (isSpanishSearch ? 'ES' : 'EN'),
          releasedOn: entry.releasedOn,
          image: hdImage,
          gallery,
          link: entry.url,
          description,
          description_es: descriptionEs,
          price: p.price,
          source,
          status: 'found',
          matchScore: match.score,
          matchType: match.matchType,
          candidatesCount: matchedEntries.length,
        };
      })
    );

    return items.length === 1 ? items[0] : items;
  },
};
