import type { Context } from '@netlify/functions';
import { buildPokemonIndex } from './pokemon-index.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-index-secret',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
};

export default async (req: Request, context: Context) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }

  // Verificar autorización manual contra INDEX_SECRET
  const secret = process.env.INDEX_SECRET;
  const authHeader = req.headers.get('Authorization') || '';
  const secretHeader = req.headers.get('x-index-secret') || '';
  const isAuthorized = Boolean(secret && (authHeader === `Bearer ${secret}` || secretHeader === secret));

  if (!isAuthorized) {
    return new Response(
      JSON.stringify({
        status: 'error',
        message: 'No autorizado. Se requiere INDEX_SECRET configurado en el entorno y cabecera de autenticación válida.',
      }),
      { status: 401, headers: CORS_HEADERS }
    );
  }

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
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        status: 'error',
        message: (err as Error).message,
      }),
      { status: 500, headers: CORS_HEADERS }
    );
  }
};
