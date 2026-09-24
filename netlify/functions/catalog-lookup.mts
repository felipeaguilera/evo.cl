import type { Context } from '@netlify/functions';
import { pokemonAdapter } from '../../src/lib/catalog/adapters/pokemon.js';
import { loadPokemonIndex } from '../../src/lib/catalog/pokemon-store.js';
import type { CatalogAdapter, CatalogItem, CatalogLookupResponse, QueryLookupResult } from '../../src/lib/catalog/types.js';

const ADAPTERS: Record<string, CatalogAdapter> = {
  pokemon: pokemonAdapter,
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
};

// Caché en memoria para ciclo de vida serverless
const LOOKUP_CACHE = new Map<string, QueryLookupResult>();

async function getIndexMeta(): Promise<{ indexGeneratedAt?: string; indexTotalProducts?: number }> {
  try {
    const idx = await loadPokemonIndex();
    if (idx) {
      return {
        indexGeneratedAt: idx.generatedAt,
        indexTotalProducts: idx.totalProducts,
      };
    }
  } catch (e) {
    console.warn('Error cargando metadata del índice:', e);
  }
  return {};
}

function formatLookupResult(query: string, rawResult: CatalogItem | CatalogItem[]): QueryLookupResult {
  const candidates = Array.isArray(rawResult) ? rawResult : [rawResult];
  const hasFound = candidates.some((c) => c.status === 'found');
  const hasError = candidates.some((c) => c.status === 'error');
  const status: 'found' | 'not_found' | 'error' = hasFound ? 'found' : hasError ? 'error' : 'not_found';
  const needsChoice = candidates.length > 1;

  return {
    query,
    status,
    needsChoice,
    candidates,
  };
}

export async function lookupCatalogItem(
  query: string,
  preferredAdapterId?: string,
  forceRefresh = false
): Promise<QueryLookupResult> {
  const cleanQuery = (query || '').trim();
  if (!cleanQuery) {
    return {
      query: '',
      status: 'error',
      needsChoice: false,
      candidates: [
        {
          query: '',
          upc: '',
          productId: 0,
          title: '',
          image: '',
          gallery: [],
          source: 'not_found',
          status: 'error',
          diagnosis: 'La consulta está vacía.',
        },
      ],
    };
  }

  const cacheKey = `${preferredAdapterId || 'auto'}:${cleanQuery}`;
  if (!forceRefresh && LOOKUP_CACHE.has(cacheKey)) {
    return LOOKUP_CACHE.get(cacheKey)!;
  }

  let selectedAdapter: CatalogAdapter = pokemonAdapter;

  if (preferredAdapterId && ADAPTERS[preferredAdapterId]) {
    selectedAdapter = ADAPTERS[preferredAdapterId];
  } else {
    // Autodetectar con mayor puntuación
    let bestScore = -1;
    for (const adapter of Object.values(ADAPTERS)) {
      const score = adapter.detect(cleanQuery);
      if (score > bestScore) {
        bestScore = score;
        selectedAdapter = adapter;
      }
    }
  }

  try {
    const parsed = selectedAdapter.parseInput(cleanQuery);
    const result = await selectedAdapter.lookup(parsed);
    const formatted = formatLookupResult(cleanQuery, result);

    LOOKUP_CACHE.set(cacheKey, formatted);
    return formatted;
  } catch (err) {
    const errorResult: QueryLookupResult = {
      query: cleanQuery,
      status: 'error',
      needsChoice: false,
      candidates: [
        {
          query: cleanQuery,
          upc: '',
          productId: 0,
          title: cleanQuery,
          image: '',
          gallery: [],
          source: 'not_found',
          status: 'error',
          diagnosis: (err as Error).message || 'Error en consulta de catálogo.',
        },
      ],
    };
    return errorResult;
  }
}

export default async (req: Request, context: Context) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }

  let adapterId: string | undefined;
  let forceRefresh = false;
  const indexMeta = await getIndexMeta();

  if (req.method === 'GET') {
    const url = new URL(req.url);
    const query = url.searchParams.get('q') || url.searchParams.get('query') || url.searchParams.get('upc') || '';
    const isInfoReq = url.searchParams.get('info') === 'true';
    adapterId = url.searchParams.get('adapter') || undefined;
    forceRefresh = url.searchParams.get('forceRefresh') === 'true';

    if (isInfoReq || (!query && url.searchParams.toString() === '')) {
      const infoResp: CatalogLookupResponse = {
        results: [],
        ...indexMeta,
      };
      return new Response(JSON.stringify(infoResp), { status: 200, headers: CORS_HEADERS });
    }

    if (!query) {
      const errorResp: CatalogLookupResponse = {
        results: [
          {
            query: '',
            status: 'error',
            needsChoice: false,
            candidates: [
              {
                query: '',
                upc: '',
                productId: 0,
                title: '',
                image: '',
                gallery: [],
                source: 'not_found',
                status: 'error',
                diagnosis: 'Parámetro de consulta requerido (q o query).',
              },
            ],
          },
        ],
        ...indexMeta,
      };
      return new Response(JSON.stringify(errorResp), { status: 400, headers: CORS_HEADERS });
    }

    try {
      const result = await lookupCatalogItem(query, adapterId, forceRefresh);
      const responseBody: CatalogLookupResponse = {
        results: [result],
        ...indexMeta,
      };
      return new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: CORS_HEADERS,
      });
    } catch (err) {
      return new Response(
        JSON.stringify({
          results: [
            {
              query,
              status: 'error',
              needsChoice: false,
              candidates: [
                {
                  query,
                  upc: '',
                  productId: 0,
                  title: query,
                  image: '',
                  gallery: [],
                  source: 'not_found',
                  status: 'error',
                  diagnosis: (err as Error).message,
                },
              ],
            },
          ],
          ...indexMeta,
        }),
        { status: 500, headers: CORS_HEADERS }
      );
    }
  }

  if (req.method === 'POST') {
    try {
      const body = await req.json();
      adapterId = body.adapter;
      forceRefresh = Boolean(body.forceRefresh);

      // Soporte para lote de hasta 10 consultas
      if (Array.isArray(body.queries) || Array.isArray(body.items)) {
        const batch: string[] = (body.queries || body.items).slice(0, 10);
        const results = await Promise.all(
          batch.map((q) => lookupCatalogItem(String(q), adapterId, forceRefresh))
        );
        const responseBody: CatalogLookupResponse = {
          results,
          ...indexMeta,
        };
        return new Response(JSON.stringify(responseBody), {
          status: 200,
          headers: CORS_HEADERS,
        });
      }

      // Consulta individual
      const singleQuery = body.q || body.query || body.upc || body.input || '';
      if (!singleQuery) {
        const errorResp: CatalogLookupResponse = {
          results: [
            {
              query: '',
              status: 'error',
              needsChoice: false,
              candidates: [
                {
                  query: '',
                  upc: '',
                  productId: 0,
                  title: '',
                  image: '',
                  gallery: [],
                  source: 'not_found',
                  status: 'error',
                  diagnosis: 'Cuerpo de petición debe contener "query" o arreglo "queries".',
                },
              ],
            },
          ],
          ...indexMeta,
        };
        return new Response(JSON.stringify(errorResp), { status: 400, headers: CORS_HEADERS });
      }

      const result = await lookupCatalogItem(singleQuery, adapterId, forceRefresh);
      const responseBody: CatalogLookupResponse = {
        results: [result],
        ...indexMeta,
      };
      return new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: CORS_HEADERS,
      });
    } catch (err) {
      return new Response(
        JSON.stringify({
          results: [
            {
              query: '',
              status: 'error',
              needsChoice: false,
              candidates: [
                {
                  query: '',
                  upc: '',
                  productId: 0,
                  title: '',
                  image: '',
                  gallery: [],
                  source: 'not_found',
                  status: 'error',
                  diagnosis: (err as Error).message,
                },
              ],
            },
          ],
          ...indexMeta,
        }),
        { status: 500, headers: CORS_HEADERS }
      );
    }
  }

  return new Response(JSON.stringify({ status: 'error', message: 'Método no soportado.' }), {
    status: 405,
    headers: CORS_HEADERS,
  });
};
