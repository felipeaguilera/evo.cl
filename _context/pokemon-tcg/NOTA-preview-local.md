# Por qué la muestra no encuentra nada en el preview local

**Fecha:** 2026-09-17
**No es un bug del código.** Es el servidor equivocado.

---

## Diagnóstico

`npm run preview` corre `astro preview`, que sirve la carpeta `dist` como sitio
estático y nada más. **No levanta las Netlify Functions ni aplica las
redirecciones de `netlify.toml`.**

La página pide `/api/catalog-lookup`, que en `netlify.toml` redirige a
`/.netlify/functions/catalog-lookup`. Bajo `astro preview` esa ruta no existe, así
que toda consulta devuelve 404 y el lote entero sale como no encontrado.

Señal que lo confirma: el badge del índice en la cabecera queda en "Cargando..."
para siempre, porque la llamada `?info=true` recibe el mismo 404.

Banpresto y Funko fallarían igual bajo `astro preview`. Funcionan porque se
prueban en producción, no en local.

---

## Cómo levantarlo bien

```powershell
cd C:\EVO\EVO-Dev\evo.cl
npx netlify dev
```

Levanta Astro y las funciones juntos, normalmente en `http://localhost:8888`, y
aplica las redirecciones de `netlify.toml`. La primera vez pregunta si instalar
`netlify-cli`, hay que aceptar.

El índice local en `.data/pokemon-index.json` sí lo encuentra: `netlify dev` corre
desde la raíz del proyecto, que es donde `pokemon-store.ts` lo busca.

Si conviene dejarlo fijo, agregar a `package.json`:

```json
"dev:netlify": "netlify dev"
```

---

## Dos cosas para arreglar, encontradas al revisar esto

### 1. La página no tiene ruta de respaldo

`pokemon-tcg.astro` línea 352:

```js
const LOOKUP_ENDPOINT = '/api/catalog-lookup';
```

Funko prueba dos rutas:

```js
const endpoints = ['/api/funko-lookup', '/.netlify/functions/funko-lookup'];
```

Conviene hacer lo mismo en Pokémon. Si la redirección no está aplicada, la
herramienta igual funciona por la ruta directa de la función.

### 2. El proxy de imágenes se invoca pero no existe

`export.ts` línea 62 llama a `${lookupEndpoint}?img=...` como respaldo cuando la
descarga directa falla por CORS. `catalog-lookup.mts` **no tiene manejador de
`img`**: devuelve 400 por falta del parámetro de consulta.

Verifiqué que hoy no rompe nada: el CDN de TCGplayer responde con
`access-control-allow-origin: *`, así que la descarga directa funciona y el
respaldo nunca se usa. Pero es un respaldo que no respalda. Portar el manejador
de `img` que ya existe en `funko-lookup.mts`, que además va a hacer falta para
las fotos que vengan de tiendas Shopify.

Ninguna de las dos bloquea la prueba local. Se arreglan junto con la fase 4.
