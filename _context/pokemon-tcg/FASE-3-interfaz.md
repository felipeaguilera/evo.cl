# Fase 3: núcleo compartido e interfaz `/tools/pokemon-tcg`

**Fecha:** 2026-09-16
**Repo:** evo.cl
**Depende de:** fases 1 y 2, cerradas y verificadas en `CIERRE-fases-1-2.md`
**Ejecuta:** Antigravity. Este archivo manda, no el resumen del chat.

---

## 1. Qué se construye y qué no

Se construye la interfaz Pokémon **sobre un núcleo compartido nuevo**, no
copiando un tercer archivo.

`funko-pop.astro` tiene 2.912 líneas y `banpresto.astro` 2.807, casi idénticas.
En la fase 3 se extrae ese motor a módulos reutilizables y Pokémon es el primer
consumidor.

**Banpresto y Funko no se tocan en esta fase.** Siguen con su código actual y su
comportamiento actual. Su migración al núcleo es la fase 4. Eso significa que
durante un tiempo el motor va a existir dos veces, y está bien: es el precio de
no romper dos herramientas que WePlay usa a diario.

Regla de oro para la extracción: **el núcleo se escribe portando el código de
`funko-pop.astro` lo más literal posible**, no reinventándolo. Así la fase 4 es
un diff comparable y no una reescritura.

---

## 2. Qué se extrae

`funko-pop.astro` tiene 27 funciones en su bloque `<script>`. Se reparten así.

### Va al núcleo, genérico

```
src/lib/catalog/ui/
  batch.js       runBatch, fetchCodeWithRetry, refreshSingleProduct,
                 pausa y reanudación, control de ritmo
  storage.js     getLocalCatalog, saveToLocalCatalog, getFromLocalCatalog,
                 getUniqueLocalFigures, updateLocalCatalogBadge,
                 loadLocalCatalogToWorkspace, import y export JSON
  render.js      renderResults, renderProductCards, getFilteredProducts,
                 showBatchSummary, vista de colecciones, badges de origen
                 y caché, toasts
  export.js      exportShopifyCsv, copyTableHtml, exportImagesZip,
                 downloadSingleProductZip, fetchImageBlob, exportCsv
  dom.js         escapeHtml, escapeAttr, generateHandle, getCleanCodes,
                 updateInputCount, showToast
```

### Va al adaptador, específico de la línea

- Qué campos muestra la tarjeta. Ya existe como `pokemonAdapter.fields`.
- Los `SAMPLE_ITEMS` del botón de muestra.
- Las columnas propias del CSV y el texto de la ficha.
- Las etiquetas de origen (`tcgcsv`, `shopify_es`, `translated`, `local_index`).

`render.js` **no puede tener nada de Pokémon adentro.** Dibuja lo que le diga
`adapter.fields`. Si aparece un `if (item.expansion)` en el núcleo, está mal.

### Va a CSS compartido

`src/styles/catalog-tool.css`, con las 144 reglas que hoy están duplicadas en los
dos `.astro`. La página Pokémon lo importa. Funko y Banpresto lo importan en la
fase 4, no ahora.

### Nota de Astro

Los `<script>` de las páginas `.astro` se procesan y empaquetan, así que
`import` funciona. Hoy esos bloques son funciones sueltas sin imports, o sea
pasar a módulos es un cambio real de estructura, no solo mover texto. Verificar
que el build sigue pasando después de cada módulo extraído, no al final.

---

## 3. Arreglar la forma de la respuesta antes de construir encima

`catalog-lookup` devuelve hoy `CatalogItem | CatalogItem[]`, y en lote devuelve
un arreglo de eso, o sea puede venir un arreglo de arreglos. El cliente tendría
que adivinar la forma en cada respuesta.

**Unificar a una sola forma, siempre:**

```json
{
  "results": [
    {
      "query": "196214146242 | ... ex Box Español",
      "status": "found",
      "needsChoice": true,
      "candidates": [ { …CatalogItem… }, { …CatalogItem… } ]
    }
  ]
}
```

- `candidates` siempre es arreglo, con uno o varios elementos.
- `needsChoice` es `true` cuando hay más de un candidato.
- Una consulta suelta devuelve `results` con un elemento. No hay caso especial.
- `status` puede ser `found`, `not_found` o `error`, por consulta, no global.

Esto se cambia ahora, antes de que haya interfaz encima. Después cuesta el doble.

---

## 4. El selector de variante

Es lo único realmente nuevo de esta fase, y es la razón por la que existe todo
el diseño de candidatos.

**El lote no se detiene a preguntar.** Con ocho códigos, cuatro pidiendo elección,
frenar en cada uno arruina el flujo. Comportamiento:

1. El lote corre completo sin interrupción.
2. Las consultas con `needsChoice` producen una tarjeta en estado **"requiere
   elección"**, visualmente distinta, con las miniaturas de los candidatos en
   fila y sus nombres.
3. El resumen del lote muestra un contador, por ejemplo "4 fichas requieren
   elegir variante", con filtro para verlas solas.
4. Al hacer clic en un candidato, la tarjeta se resuelve, pasa a estado normal y
   **la elección se guarda en el catálogo local junto al UPC consultado**.
5. La próxima vez que ese UPC aparezca en un lote, se resuelve solo con la
   elección guardada, marcado como `fromCache`, con opción de cambiarla.

**Una tarjeta sin resolver no se exporta.** El CSV, el ZIP y la tabla para pegar
excluyen las que siguen en "requiere elección", y el botón de exportar avisa
cuántas quedaron fuera. Es preferible un CSV incompleto a un CSV con la variante
equivocada, que es exactamente el problema que esta fase existe para evitar.

---

## 5. La página

`src/pages/tools/pokemon-tcg.astro`, con paridad funcional respecto a Funko:

- Entrada de códigos con contador, botón de muestra y de limpiar.
- Control de ritmo del lote, pausa, reanudación y reinicio.
- Panel de catálogo local con cargar, exportar JSON, importar JSON y vaciar.
- Barra de progreso con desglose por fuente. Para Pokémon las fuentes son
  `local_index`, `tcgcsv`, `shopify_es`, `translated` y `not_found`, no las de
  Funko.
- Vista de tarjetas y vista de colecciones, agrupando por **expansión**
  (`groupName`), que es el equivalente de licencia en Funko.
- Filtros por texto y por estado, más el filtro nuevo de "requiere elección".
- Exportar CSV Shopify en español y en inglés, copiar tabla HTML, ZIP de fotos,
  CSV general.
- Drawer bilingüe y modal de progreso del ZIP, igual que las otras dos.

**Muestra:** los 8 SKU de WePlay de la sección 1 del `PLAN.md`, con su formato
`UPC Título`, que es como llegan de la planilla.

**Aviso de una sola foto.** TCGplayer entrega una imagen HD por producto. Cuando
la galería tiene un solo elemento y no hubo enriquecimiento español, la tarjeta
lo dice en vez de dejar que parezca un error.

**Fecha del índice a la vista.** En algún lugar de la cabecera, el `generatedAt`
del índice en uso. Es la señal de frescura que costó dos revisiones conseguir, no
sirve si no se muestra.

### Tocar también

- `src/pages/tools/index.astro`: cuarta tarjeta apuntando a `/tools/pokemon-tcg`.
- `netlify.toml`: redirección `/api/catalog-lookup` hacia la función, igual que
  la que ya existe para `funko-lookup`.

---

## 6. Criterios de aceptación

1. `npm run build` pasa sin errores ni warnings nuevos. Lo verifica Felipe en su
   máquina, no el agente.
2. Los 8 SKU de muestra corren como lote completo sin intervención. Cuatro quedan
   resueltos y cuatro en "requiere elección".
3. Elegir una variante resuelve la tarjeta y la elección sobrevive a recargar la
   página.
4. Volver a correr el mismo lote resuelve los ocho de inmediato desde el catálogo
   local, marcados como caché.
5. Exportar con tarjetas sin resolver las excluye y avisa cuántas.
6. El CSV Shopify en español abre en Excel con tildes correctas y una fila por
   producto.
7. El ZIP trae las fotos nombradas por UPC.
8. `banpresto.astro`, `funko-pop.astro` y sus dos funciones quedan **sin
   modificar**. Verificar con `git status` antes de reportar.
9. `git diff --stat --ignore-all-space` muestra solo lo que se tocó.
10. No hay ninguna referencia a Pokémon dentro de `src/lib/catalog/ui/`.

---

## 7. Fuera de alcance

- Migrar Banpresto y Funko al núcleo. Es la fase 4.
- El generador de ficha HTML y el botón de exportarla. Es la fase 6 y depende de
  la sonda, que sigue sin correr porque falta acceso a Sphinx. **No escribirlo.**
- El selector de tipo de producto y la autodetección entre líneas. Es la fase 5.
- Precios de mercado de TCGplayer.
