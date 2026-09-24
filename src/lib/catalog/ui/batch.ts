import type { CatalogItem, CatalogLookupResponse, QueryLookupResult } from '../types.js';
import { getFromLocalCatalog, saveToLocalCatalog } from './storage.js';

export interface BatchItemState extends CatalogItem {
  needsChoice?: boolean;
  candidates?: CatalogItem[];
  fromCache?: boolean;
}

export interface BatchRunContext {
  storageKey: string;
  lookupEndpoint?: string;
  pacing?: 'fast' | 'moderate' | 'safe';
  onProgress?: (completed: number, total: number, currentItem?: BatchItemState) => void;
  onIndexMeta?: (meta: { generatedAt?: string; totalProducts?: number }) => void;
  onStatsUpdate?: (stats: {
    total: number;
    local: number;
    sources: Record<string, number>;
    notFound: number;
    needsChoice: number;
  }) => void;
  onRender?: () => void;
  onComplete?: (products: BatchItemState[]) => void;
  onError?: (err: Error) => void;
}

/**
 * Fetch a single query with local cache fallback and retry support.
 */
export async function fetchCodeWithRetry(
  query: string,
  storageKey: string,
  forceRefresh = false,
  lookupEndpoint = '/api/catalog-lookup',
  retryCount = 1,
  onIndexMeta?: (meta: { generatedAt?: string; totalProducts?: number }) => void
): Promise<BatchItemState> {
  // 1. Verificar base local primero si no es forceRefresh
  if (!forceRefresh) {
    const cached = getFromLocalCatalog(storageKey, query);
    if (cached && cached.status === 'found') {
      return {
        ...cached,
        query,
        source: cached.source || 'local_index',
        fromCache: true,
        needsChoice: false,
      };
    }
  }

  const endpoints = [
    lookupEndpoint,
    '/.netlify/functions/catalog-lookup',
  ];

  for (const ep of endpoints) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 9000);

      const res = await fetch(ep, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, forceRefresh }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data: CatalogLookupResponse = await res.json();
        if (onIndexMeta && (data.indexGeneratedAt || data.indexTotalProducts)) {
          onIndexMeta({ generatedAt: data.indexGeneratedAt, totalProducts: data.indexTotalProducts });
        }
        if (data.results && data.results.length > 0) {

          const qResult: QueryLookupResult = data.results[0];

          if (qResult.needsChoice && qResult.candidates && qResult.candidates.length > 1) {
            // Requiere selección del usuario entre variantes
            const primary = qResult.candidates[0];
            return {
              ...primary,
              query,
              status: 'found',
              needsChoice: true,
              candidates: qResult.candidates,
              fromCache: false,
            };
          }

          if (qResult.candidates && qResult.candidates.length > 0) {
            const item = qResult.candidates[0];
            if (item.status === 'found') {
              saveToLocalCatalog(storageKey, item);
            }
            return {
              ...item,
              query,
              needsChoice: false,
              fromCache: false,
            };
          }
        }
      } else if (res.status === 429 || res.status === 408) {
        if (retryCount > 0) {
          await new Promise((r) => setTimeout(r, 1500));
          return fetchCodeWithRetry(query, storageKey, forceRefresh, lookupEndpoint, retryCount - 1);
        }
      }
    } catch (e) {
      console.warn(`[Catalog Tool] Error en ${ep} para "${query}":`, (e as Error).message);
    }
  }

  // Fallback no encontrado
  const upcMatch = query.match(/\b\d{12,13}\b/);
  const upc = upcMatch ? upcMatch[0] : '';

  return {
    query,
    upc,
    productId: 0,
    title: query,
    image: '',
    gallery: [],
    source: 'not_found',
    status: 'not_found',
    diagnosis: 'No indexado en catálogo comercial o sin conexión a la red.',
    needsChoice: false,
    fromCache: false,
  };
}

/**
 * Controller class to manage batch execution, pause, resume, and cancellation.
 */
export class BatchRunner {
  private isRunning = false;
  private isPaused = false;
  private products: BatchItemState[] = [];

  public get running(): boolean {
    return this.isRunning;
  }

  public get paused(): boolean {
    return this.isPaused;
  }

  public get productList(): BatchItemState[] {
    return this.products;
  }

  public setProductList(list: BatchItemState[]) {
    this.products = list;
  }

  public pause(): void {
    if (this.isRunning) {
      this.isPaused = true;
    }
  }

  public resume(): void {
    if (this.isRunning) {
      this.isPaused = false;
    }
  }

  public cancel(): void {
    this.isRunning = false;
    this.isPaused = false;
  }

  public async run(codes: string[], ctx: BatchRunContext): Promise<BatchItemState[]> {
    if (codes.length === 0) return [];

    this.isRunning = true;
    this.isPaused = false;
    this.products = [];

    const pacing = ctx.pacing || 'fast';
    let chunkSize = 3;
    let delayMs = 200;

    if (pacing === 'moderate') {
      chunkSize = 2;
      delayMs = 400;
    } else if (pacing === 'safe') {
      chunkSize = 1;
      delayMs = 800;
    }

    let completed = 0;

    for (let i = 0; i < codes.length; i += chunkSize) {
      if (!this.isRunning) break;

      while (this.isPaused) {
        await new Promise((r) => setTimeout(r, 200));
        if (!this.isRunning) break;
      }

      const chunk = codes.slice(i, i + chunkSize);

      try {
        const results = await Promise.all(
          chunk.map((c) => fetchCodeWithRetry(c, ctx.storageKey, false, ctx.lookupEndpoint, 1, ctx.onIndexMeta))
        );


        for (const item of results) {
          this.products.push(item);
          completed++;
          if (ctx.onProgress) {
            ctx.onProgress(completed, codes.length, item);
          }
        }
      } catch (batchErr) {
        console.warn('Batch chunk error:', batchErr);
        chunk.forEach((c) => {
          const fallbackItem: BatchItemState = {
            query: c,
            upc: '',
            productId: 0,
            title: c,
            image: '',
            gallery: [],
            source: 'not_found',
            status: 'not_found',
            diagnosis: 'Error de conexión durante el lote.',
            needsChoice: false,
            fromCache: false,
          };
          this.products.push(fallbackItem);
          completed++;
          if (ctx.onProgress) {
            ctx.onProgress(completed, codes.length, fallbackItem);
          }
        });
      }

      // Compute stats
      if (ctx.onStatsUpdate) {
        const local = this.products.filter((p) => p.fromCache || p.source === 'local_index').length;
        const notFound = this.products.filter((p) => p.status !== 'found').length;
        const needsChoice = this.products.filter((p) => p.needsChoice).length;
        const sources: Record<string, number> = {};

        this.products.forEach((p) => {
          const s = p.source || 'other';
          sources[s] = (sources[s] || 0) + 1;
        });

        ctx.onStatsUpdate({
          total: this.products.length,
          local,
          sources,
          notFound,
          needsChoice,
        });
      }

      if (ctx.onRender) {
        ctx.onRender();
      }

      if (delayMs > 0 && i + chunkSize < codes.length) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }

    this.isRunning = false;
    this.isPaused = false;

    if (ctx.onComplete) {
      ctx.onComplete(this.products);
    }

    return this.products;
  }
}
