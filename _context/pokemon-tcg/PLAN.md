# Plan: scraper Pokémon TCG y núcleo compartido de catálogo

**Fecha:** 2026-09-16
**Repo:** evo.cl (Astro + Netlify Functions)
**Cliente:** WePlay
**Estado:** plan aprobado en diseño, pendiente de implementación
**Ejecuta:** Antigravity. **Manda este archivo**, no el resumen del chat.

---

## 1. Qué se verificó antes de escribir esto

Se probaron fuentes reales contra los 8 SKU de WePlay el 16-09-2026. Nada de lo
que sigue es supuesto.

| Fuente | Resultado de la prueba | Veredicto |
|---|---|---|
| `tcgcsv.com` (volcado público del catálogo de TCGplayer) | Abierto, sin llave, categoría Pokémon actualizada ese mismo día a las 17:34 | **Fuente maestra** |
| `pokemon.com` y `tcg.pokemon.com`, todas las variantes de idioma | Devuelven challenge de Imperva/Incapsula, no HTML de producto | **Descartada** |
| `api.upcitemdb.com` | Responde 200 pero `total: 0` en los 8 códigos | **Se elimina ese tier** |
| Tiendas Shopify en español (`pokemillon.com`, `todohits.com`) | `/products.json` y `/search/suggest.json` abiertos, `body_html` en español real | **Tier español** |
| CDN de imágenes de TCGplayer | `{productId}_in_1000x1000.jpg` responde 200 (114 KB) | **Imagen HD** |

### Resultado con los 8 SKU de prueba

Por UPC exacto contra TCGCSV: los 4 en inglés resuelven, los 4 en español no
existen en el catálogo de TCGplayer (TCGplayer no lista las ediciones en español
de LatAm).

Agregando normalización de título, la cobertura sube a 8 de 8:

| SKU | Producto | Vía | Candidatos |
|---|---|---|---|
| 196214158801 | Elite Trainer Box English | UPC exacto | 1 (704143) |
| 196214158757 | Poster Collection English | UPC exacto | 1 (704153) |
| 196214158771 | Tech Sticker Collection English | UPC exacto | **3** |
| 196214158726 | ex Box English | UPC exacto | **2** |
| 196214144873 | Elite Trainer Box Español | Título normalizado | 1 (704143) |
| 196214147263 | Poster Collection Español | Título normalizado | 1 (704153) |
| 196214146242 | ex Box Español | Título normalizado | **varios** |
| 196214145016 | Tech Sticker Collection Español | Título normalizado | **varios** |

**Hallazgo clave:** el UPC no es una llave única. The Pokémon Company reutiliza
un mismo código entre variantes de un display (Sylveon ex Box y Greninja ex Box
comparten `0196214158726`; las tres Tech Sticker Collection comparten
`0196214158771`). Cualquier diseño que asuma "un UPC, un producto" va a devolver
la variante equivocada en silencio. La herramienta tiene que resolver esto en la
interfaz, no adivinar.

---

## 2. Arquitectura

Decisión: **núcleo compartido más adaptador por línea de producto.** No se copia
el patrón a un tercer archivo de 2.800 líneas.

Hoy `banpresto.astro` (2.807 líneas) y `funko-pop.astro` (2.912 líneas) son casi
el mismo archivo. Lo que difiere de verdad es: de dónde sale el dato, cómo se
parsea el input y qué campos muestra la ficha. Todo lo demás (cola del lote,
pausa y reanudación, catálogo local en `localStorage`, badges de origen y caché,
modal de ZIP, toasts, drawer bilingüe, exports) es idéntico.

### Estructura objetivo

```
src/lib/catalog/
  core.ts            motor de lote, cola, pausa, reintentos
  storage.ts         catálogo local, import y export JSON
  export.ts          CSV, tabla HTML para pegar, ZIP de fotos
  render.ts          tarjetas, filtros, colecciones, badges
  types.ts           CatalogItem normalizado, común a todas las líneas
  adapters/
    pokemon.ts
    banpresto.ts     (migra en fase 4)
    funko.ts         (migra en fase 4)

netlify/functions/
  catalog-lookup.mts     entrada única, despacha por adaptador
  pokemon-index.mts      job que reconstruye el índice desde TCGCSV
```

### El contrato del adaptador

Cada adaptador expone lo mismo. Ese es todo el truco de la consolidación.

```ts
interface CatalogAdapter {
  id: 'pokemon' | 'banpresto' | 'funko';
  label: string;
  detect(input: string): number;          // 0 a 1, para el autodetector
  parseInput(raw: string): ParsedInput;   // UPC, título, precio
  lookup(p: ParsedInput): Promise<CatalogItem | CatalogItem[]>;
  fields: FieldSpec[];                    // qué muestra la ficha
}
```

`lookup` puede devolver un arreglo. Eso es lo que resuelve el problema de las
variantes que comparten UPC: la interfaz muestra un selector en la tarjeta en vez
de elegir por su cuenta.

### El autodetector, más adelante

`detect()` devuelve confianza, no un booleano. Reglas concretas que ya se pueden
escribir hoy: prefijo `196214` es Pokémon; prefijo `889698` es Funko; JAN de 13
dígitos que parte en `45` es Banpresto. Si ninguna pasa cierto umbral, la
interfaz pregunta en vez de asumir. Esto entra en la fase 5, no antes.

---

## 3. El adaptador Pokémon

### 3.1 Índice local, no scraping por consulta

Esta es la diferencia grande con Banpresto y Funko. Aquellos consultan la fuente
en cada búsqueda. Pokémon no: se construye un índice y se consulta en memoria.

Motivo: TCGCSV es un servicio gratuito sin garantía, y la regla 8 de `AGENTS.md`
exige copia local del dato. Además es más rápido y no depende de que la fuente
esté arriba en el momento de la consulta.

**Job `pokemon-index.mts`** (programado, una vez al día):

1. `GET /tcgplayer/categories` para confirmar que la categoría Pokémon sigue
   siendo la 3 (no asumirlo, ya que la 85 es Pokemon Japan y podría servir
   después para otra línea).
2. `GET /tcgplayer/3/groups` (220 grupos hoy).
3. Por cada grupo, `GET /tcgplayer/3/{groupId}/products`.
4. Quedarse solo con productos sellados, es decir los que traen `UPC` en
   `extendedData` o cuyo nombre contenga Box, Collection, Tin, Booster, Bundle,
   Case, Binder, Poster, Sticker. Se descartan las cartas sueltas.
5. Escribir a Netlify Blobs dos índices: `byUpc` y `byNormalizedTitle`.

Medición real: 8 grupos tomaron 3,0 segundos y trajeron 1.355 productos, 105 de
ellos con UPC. Extrapolado a 220 grupos son unos 80 segundos y del orden de 2 a 3
mil productos sellados. El índice queda bajo 1 MB. Cabe sin problema en Blobs.

El job es idempotente: correrlo dos veces seguidas produce el mismo archivo.

### 3.2 Resolución de una consulta

```
entrada: "196214144873 | Pokemon TCG 30th Celebration - Elite Trainer Box Español"

1. UPC normalizado (rellenar a 13 con cero a la izquierda) contra byUpc
   -> 1 resultado  : listo
   -> N resultados : desempatar por título contra esos N
   -> 0 resultados : seguir

2. Título normalizado contra byNormalizedTitle
   normalizar = sin tildes, minúsculas, sin "pokemon", "tcg", "español",
   "english", sin puntuación
   -> 1 resultado  : listo
   -> N resultados : devolver los N, la interfaz pregunta

3. Ranking por similitud (Jaccard sobre tokens), no filtro booleano
   El filtro booleano "contiene todos los tokens" mete Elite Trainer Box como
   candidato de "ex Box" porque comparten el token "box". Verificado. Hay que
   puntuar y ordenar, y cortar bajo un umbral.

4. Si es producto en español y hay match: enriquecer con tienda ES
   Shopify /search/suggest.json en pokemillon.com y todohits.com.
   Si hay coincidencia razonable, la descripción y las fotos extra salen de ahí.
   Si no, se usa la descripción en inglés traducida con el helper
   translateToSpanish() que ya existe en funko-lookup.mts.

5. Sin match: estado not_found con diagnóstico, igual que las otras dos
   herramientas
```

### 3.3 Campos de la ficha Pokémon

`upc`, `productId`, `title`, `titleEs`, `expansion` (el `groupName`, por ejemplo
"ME: 30th Celebration"), `productType` (Elite Trainer Box, Booster Pack, Tin,
Collection), `variant` (Sylveon ex, Lucario), `language` (EN o ES), `releasedOn`
(viene en `presaleInfo.releasedOn`), `image` y `gallery`, `link`, `description` y
`description_es`, `price` (el del input de WePlay manda sobre cualquier precio
scrapeado, misma regla que Banpresto).

**Limitación conocida:** `imageCount` dice 2 pero solo la primera imagen es
alcanzable en el CDN. Probado: `_2_in_1000x1000.jpg` devuelve 403. Así que desde
TCGplayer viene **una sola foto HD por producto**, no galería multi-ángulo como
en Funko. Las fotos adicionales tienen que salir de la tienda Shopify en español.
Esto hay que decirlo en la interfaz, no dejar que se note como un error.

---

## 4. Fases

### Fase 1, índice Pokémon
`pokemon-index.mts` más el esquema en Blobs. Sin interfaz todavía.
**Aceptación:** el job corre dos veces y produce el mismo índice. `byUpc` contiene
`0196214158801` apuntando a 704143. El índice pesa menos de 2 MB.

### Fase 2, adaptador y función de consulta
`adapters/pokemon.ts` más `catalog-lookup.mts` con la cascada de la sección 3.2.
**Aceptación:** los 8 SKU de prueba devuelven resultado. Los 4 con candidato único
resuelven directo. Los 4 ambiguos devuelven un arreglo con el candidato correcto
en primer lugar del ranking, nunca un Elite Trainer Box como respuesta a "ex Box".

### Fase 3, interfaz `/tools/pokemon-tcg`
Reusa el motor extraído a `src/lib/catalog/`. Agrega el selector de variante
cuando `lookup` devuelve varios.
**Aceptación:** paridad funcional con Funko (lote, pausa, catálogo local, filtros,
exports CSV y ZIP). El selector de variante aparece en las 4 fichas ambiguas y la
elección persiste en el catálogo local.

### Fase 4, migración de Banpresto y Funko
Se reescriben sobre el núcleo compartido, sin cambiar su interfaz ni sus URL.
**Aceptación:** las dos herramientas siguen dando exactamente el mismo resultado
que antes en un lote de control guardado previamente. Cero cambios visibles.

### Fase 5, buscador unificado
`/tools/catalogo` con selector de tipo y autodetección. Las tres URL anteriores
siguen funcionando y redirigen.
**Aceptación:** pegar una lista mezclada de códigos Funko, Banpresto y Pokémon
clasifica cada uno correctamente o pregunta, nunca clasifica mal en silencio.

### Fase 6, export HTML de fichas
Depende del resultado de la sonda. Ver `sonda-html-sphinx.html` en esta misma
carpeta y la sección 5.

**Las fases 1 a 3 son un entregable completo y útil por sí solo.** Si el proyecto
se detiene ahí, WePlay igual tiene su scraper Pokémon andando.

---

## 5. Export HTML, evaluación de factibilidad

Contexto: WePlay corre Magento, pero las fichas se administran con un módulo
chileno llamado Sphinx, en un campo de texto básico. La hipótesis de Felipe es
que metiendo HTML limpio en ese campo se obtiene una ficha mucho mejor sin tocar
la plataforma.

La hipótesis es razonable y probablemente correcta, pero hay cuatro incógnitas
que no se resuelven leyendo documentación, solo probando contra el campo real:

1. **¿El campo escapa el HTML?** Si Sphinx guarda y devuelve el texto escapado,
   se ve el código en pantalla y no hay nada que hacer por esta vía.
2. **¿Sobrevive un bloque `<style>`?** Muchos sanitizadores lo borran. Si no
   sobrevive, todo el estilo tiene que ir inline en cada elemento, que funciona
   pero es verboso y pesado.
3. **¿Sobrevive un `<iframe>`?** Es lo primero que borra cualquier sanitizador.
   Sin iframe no hay YouTube embebido y hay que ir al plan B: miniatura de
   YouTube enlazada, que se ve casi igual y siempre pasa.
4. **¿El tema de Magento pisa los estilos?** Un `h2` dentro de la descripción
   hereda el CSS del tema. Por eso todo va con prefijo de clase propio.

### Lo que ya se puede afirmar sin probar

- **Nada de JavaScript.** Se borra siempre. La galería tiene que ser CSS puro.
  Con `scroll-snap-type` se logra un carrusel horizontal decente sin una línea
  de JS, y degrada a una fila con scroll si el navegador es viejo.
- **Nada de `h1` en la descripción.** La ficha de producto ya tiene su `h1` con
  el nombre. Dos `h1` en una página es un error de SEO. La jerarquía parte en
  `h2`.
- **Todo con prefijo `.evo-ficha`**, para no chocar con el tema.
- **Imágenes con URL absoluta**, apuntando al CDN, nunca rutas relativas.

### La sonda

`sonda-html-sphinx.html` en esta carpeta es un bloque autocontenido con siete
secciones numeradas, cada una probando una capacidad distinta. Felipe lo pega en
el campo de un producto de prueba en Sphinx, guarda, mira la ficha publicada y
reporta qué números sobrevivieron. El archivo también se puede abrir en el
navegador para ver cómo debería verse.

Con ese resultado se define el perfil del generador: completo con `<style>` e
iframe, intermedio con estilos inline y miniatura enlazada, o mínimo con solo
texto estructurado.

**No escribir el generador HTML antes de tener el resultado de la sonda.**

---

## 6. Riesgos y modos de falla

| Riesgo | Modo de falla | Mitigación |
|---|---|---|
| TCGCSV es gratuito sin garantía y podría caer o cerrar | La herramienta deja de resolver | El índice local es la fuente de consulta. Si el job falla, se sigue sirviendo el último índice bueno, marcado con su fecha en la interfaz |
| UPC compartido entre variantes | Se publica la ficha del producto equivocado | `lookup` devuelve arreglo, la interfaz obliga a elegir. Nunca autoseleccionar cuando hay empate |
| Ediciones en español fuera del catálogo de TCGplayer | 4 de 8 SKU sin datos | Cascada de la sección 3.2, verificada: 8 de 8 con título normalizado |
| Una sola foto HD por producto en TCGplayer | Fichas más pobres que las de Funko | Enriquecer con Shopify ES. Decirlo en la interfaz |
| La migración de la fase 4 rompe Banpresto o Funko en producción | Dos herramientas caídas | Lote de control guardado antes de migrar, comparación de salida campo por campo |
| Sphinx sanitiza el HTML | El export de fichas no sirve | Sonda primero, generador después |

---

## 7. Fuera de alcance

- Precios de mercado de TCGplayer. Existen en TCGCSV, pero el precio que manda es
  el de WePlay, igual que en Banpresto.
- Cartas sueltas. Solo producto sellado.
- Magic y One Piece. El contrato de adaptador los deja preparados, pero ninguna
  fuente fue verificada todavía para esas líneas.
- Escribir de vuelta en Magento o Sphinx por API. La salida es texto para pegar.
