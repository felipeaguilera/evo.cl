# Revisión de la fase 3

**Fecha:** 2026-09-17
**Veredicto:** la arquitectura quedó bien. Hay tres cosas que corregir, una de
ellas grave porque son datos inventados.

---

## Lo que quedó bien

- **La extracción funcionó.** `pokemon-tcg.astro` pesa 37 KB contra los 105 KB de
  `funko-pop.astro`. El motor vive en `src/lib/catalog/ui/` (batch, dom, export,
  render, storage) y las 1.530 líneas de CSS en `src/styles/catalog-tool.css`.
- **Banpresto y Funko intactos.** No aparecen en `git status` y conservan su fecha
  del 3 de septiembre. Criterio 8 cumplido.
- **La forma de la respuesta quedó unificada** a
  `{ results: [ { query, status, needsChoice, candidates } ] }`, siempre igual,
  como pedía la sección 3.
- **El selector de variante está completo:** tarjeta distinta, miniaturas en fila,
  y al elegir se hace `saveToLocalCatalog`, así que la elección persiste.
- **El lote consulta la base local antes de la red**, con claves por query, sku y
  upc, y marca `fromCache`. Criterios 3 y 4 cubiertos en código.
- **Los exports excluyen las tarjetas sin resolver** y avisan cuántas quedaron
  fuera. Criterio 5 cumplido.
- `netlify.toml` con la redirección `/api/catalog-lookup`, y la cuarta tarjeta en
  `/tools/`.
- `git diff --stat --ignore-all-space` limpio.

---

## 1. La muestra son datos inventados

La sección 5 de la especificación decía textual: *"Muestra: los 8 SKU de WePlay de
la sección 1 del PLAN.md, con su formato UPC Título, que es como llegan de la
planilla."*

Lo que quedó en `pokemon-tcg.astro` son ocho códigos distintos, de los cuales solo
uno (`196214146242`) pertenece a la lista real. Los otros siete están inventados,
con nombres de producto que no existen: "ME30 Booster Pack Español",
"Scarlet & Violet 9 Booster Bundle", "SV09 Elite Trainer Box".

Los probé todos contra el índice:

```
196214146242  NO EXISTE en el índice
196214146280  NO EXISTE en el índice
196214146310  NO EXISTE en el índice
196214146372  NO EXISTE en el índice
196214120952  NO EXISTE en el índice
196214121010  NO EXISTE en el índice
196214121041  NO EXISTE en el índice
196214121072  NO EXISTE en el índice
```

Ocho de ocho. El botón de muestra es lo primero que toca cualquiera que abre la
herramienta, y hoy devolvería una pantalla completa de "no encontrado".

Además el criterio de aceptación 2 decía que la muestra tiene que dar cuatro
resueltos y cuatro en "requiere elección". Con estos códigos es imposible que
pase, y sin embargo se reportó la fase como terminada.

**Corrección:** reemplazar por la lista real, que está en la sección 1 del
`PLAN.md` y da exactamente el reparto que pide el criterio:

```
196214158801 Pokemon TCG 30th Celebration - Elite Trainer Box English
196214158757 Pokemon TCG 30th Celebration - Poster Collection English
196214158771 Pokemon TCG 30th Celebration - Tech Sticker Collection English
196214158726 Pokemon TCG 30th Celebration - ex Box English
196214144873 Pokemon TCG 30th Celebration - Elite Trainer Box Español
196214147263 Pokemon TCG 30th Celebration - Poster Collection Español
196214146242 Pokemon TCG 30th Celebration - ex Box Español
196214145016 Pokemon TCG 30th Celebration - Tech Sticker Collection Español
```

El mismo texto del `placeholder` del textarea tiene el problema y también hay que
cambiarlo.

**Regla para adelante: los datos de ejemplo no se inventan.** Si falta un dato,
se pide, no se rellena con algo que parezca verosímil.

---

## 2. La fecha del índice se congela en el build

En el frontmatter de la página:

```astro
const indexData = await loadPokemonIndex();
const generatedAt = indexData?.generatedAt || 'Sin fecha';
```

El frontmatter de Astro corre durante `npm run build`, no cuando el visitante
abre la página. Esta página es estática: `astro.config.mjs` no declara `output` y
`netlify.toml` publica `dist`.

Dos consecuencias:

1. **En Netlify probablemente muestre "Sin fecha" y 0 productos.** El respaldo
   `.data/pokemon-index.json` está en `.gitignore` y no existe en el entorno de
   build, y Blobs no es confiable en tiempo de build.
2. **Aunque resolviera, quedaría congelada.** Reflejaría cuándo se compiló el
   sitio, no cuándo corrió el job diario, y no cambiaría nunca sola.

Es la tercera vez que el indicador de frescura se rompe por una vía distinta:
primero el timestamp escrito a mano, después el 401 que impedía la corrida
programada, ahora el build time. El punto del badge es delatar un índice viejo, y
así no delata nada.

**Corrección:** servirlo en tiempo de ejecución.

- Que `catalog-lookup` incluya `indexGeneratedAt` e `indexTotalProducts` en la
  respuesta, y la página actualice el badge con cada consulta.
- Y una llamada liviana al cargar la página, para que el badge no salga vacío
  antes de la primera búsqueda.

De paso, sacar `loadPokemonIndex` del frontmatter: mete `@netlify/blobs` y
`node:fs` en el build de una página estática, que no corresponde.

---

## 3. El núcleo sabe de Pokémon

El criterio 10 decía que no puede haber nada de Pokémon dentro de
`src/lib/catalog/ui/`, y la especificación dio el ejemplo exacto: *"Si aparece un
`if (item.expansion)` en el núcleo, está mal."*

`render.ts` línea 185:

```ts
const candExpansion = cand.expansion ? `<span class="badge-tag">...` : '';
```

Y en `export.ts` hay una columna fija `Expansion`, más el patrón que ya empezó:

```ts
`"${(item as any).expansion || (item as any).license || ''}"`
```

Ese `expansion || license` es el whack-a-mole arrancando, y el `as any` es la
señal de que los tipos ya no calzan. Funciona hoy con un solo adaptador. La fase
4, cuando entren Banpresto y Funko, es donde se paga.

**Corrección:** que `render.ts` y `export.ts` dibujen según `adapter.fields`, que
ya existe en `pokemon-spec.ts` y es justo para esto. El adaptador declara qué
campo agrupa las colecciones y qué columnas exporta, el núcleo no lo sabe.

No es bloqueante para que la herramienta funcione. Sí lo es para que la fase 4 no
sea una reescritura.

---

## Menores

1. **Falta el aviso de una sola foto.** La sección 5 pedía que, cuando la galería
   tenga un solo elemento y no hubo enriquecimiento español, la tarjeta lo diga en
   vez de dejar que parezca un error. No está en ninguna parte.

2. **`saveToLocalCatalog` guarda el mismo objeto bajo tres claves** (query, sku,
   upc). Con descripciones de hasta 2.310 caracteres más las URL de galería, la
   cuota de `localStorage` se alcanza antes que con Funko, y el fallo se traga con
   un `console.warn`: el usuario pierde su catálogo sin enterarse. Es
   comportamiento portado de Funko tal cual, que era la instrucción, pero conviene
   detectar `QuotaExceededError` y avisar.

---

## Orden de corrección

1. La muestra real y el placeholder.
2. Fecha del índice en tiempo de ejecución, y sacar `loadPokemonIndex` del
   frontmatter.
3. Aviso de una sola foto.
4. `render.ts` y `export.ts` manejados por `adapter.fields`.
5. Aviso de cuota llena en el catálogo local.

Después de 1, correr la muestra completa y reportar cuántas quedaron resueltas y
cuántas en "requiere elección". Tienen que ser cuatro y cuatro.
