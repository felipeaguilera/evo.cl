import { getStore } from '@netlify/blobs';
import fs from 'node:fs';
import path from 'node:path';
import type { PokemonIndexData } from './types.js';

const STORE_NAME = 'pokemon-index';
const BLOB_KEY = 'latest-index.json';
const LOCAL_FALLBACK_PATH = path.resolve(process.cwd(), '.data/pokemon-index.json');

let inMemoryIndex: PokemonIndexData | null = null;

export async function savePokemonIndex(data: PokemonIndexData): Promise<void> {
  inMemoryIndex = data;
  const jsonString = JSON.stringify(data);

  // 1. Guardar en respaldo local siempre para fallback offline y desarrollo local
  try {
    const dir = path.dirname(LOCAL_FALLBACK_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(LOCAL_FALLBACK_PATH, jsonString, 'utf-8');
  } catch (err) {
    console.warn('[pokemon-store] No se pudo escribir respaldo local:', err);
  }

  // 2. Guardar en Netlify Blobs si esta configurado
  try {
    const store = getStore(STORE_NAME);
    await store.set(BLOB_KEY, jsonString, {
      metadata: {
        totalProducts: String(data.totalProducts),
        generatedAt: data.generatedAt,
      },
    });
  } catch (err) {
    console.warn('[pokemon-store] Netlify Blobs no disponible o sin credenciales, se uso respaldo local:', (err as Error).message);
  }
}

function ensureMemoryIndex(data: PokemonIndexData): PokemonIndexData {
  if (data.products) {
    if (!data.byId) {
      const map: Record<number, any> = {};
      for (const p of data.products) {
        map[p.productId] = p;
      }
      data.byId = map;
    }
  }
  return data;
}

export async function loadPokemonIndex(): Promise<PokemonIndexData | null> {
  if (inMemoryIndex) {
    return ensureMemoryIndex(inMemoryIndex);
  }

  // 1. Intentar cargar desde Netlify Blobs
  try {
    const store = getStore(STORE_NAME);
    const blobData = await store.get(BLOB_KEY, { type: 'json' });
    if (blobData && typeof blobData === 'object' && 'byUpc' in blobData) {
      inMemoryIndex = ensureMemoryIndex(blobData as PokemonIndexData);
      return inMemoryIndex;
    }
  } catch (err) {
    // Blobs no disponible localmente, intentar fallback
  }

  // 2. Intentar cargar desde respaldo local en disco
  try {
    if (fs.existsSync(LOCAL_FALLBACK_PATH)) {
      const content = fs.readFileSync(LOCAL_FALLBACK_PATH, 'utf-8');
      const parsed = JSON.parse(content) as PokemonIndexData;
      inMemoryIndex = ensureMemoryIndex(parsed);
      return inMemoryIndex;
    }
  } catch (err) {
    console.warn('[pokemon-store] Error al leer respaldo local:', err);
  }

  return null;
}
