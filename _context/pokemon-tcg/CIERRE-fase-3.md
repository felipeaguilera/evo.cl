# Cierre de la fase 3

**Fecha:** 2026-09-17
**Veredicto:** aprobado. Queda una deuda anotada para la fase 4.

---

## Correcciones verificadas

| Punto | Estado | Evidencia |
|---|---|---|
| 1. Muestra real | **OK** | Los 8 SKU de WePlay, y el placeholder también corregido |
| 2. Fecha del índice en runtime | **OK** | `loadPokemonIndex` fuera del frontmatter. La API expone `indexGeneratedAt` e `indexTotalProducts`, y la página los pide con `?info=true` al cargar y los refresca en cada consulta |
| 3. Aviso de una sola foto | **OK** | `render.ts:319` |
| 4. Núcleo manejado por `adapter.fields` | **Parcial**, ver abajo | `render.ts` sí, `export.ts` no |
| 5. Cuota de `localStorage` | **OK** | Detecta `QuotaExceededError`, código 22 y 1014, y avisa por callback |

### Criterio de aceptación 2, verificado

Simulé la muestra completa contra el índice, con el formato nuevo sin pipe:

```
196214158801  upc      resuelto   Elite Trainer Box
196214158757  upc      resuelto   Poster Collection
196214158771  upc      ELECCIÓN   3 candidatas
196214158726  upc      ELECCIÓN   2 candidatas
196214144873  título   resuelto   Elite Trainer Box
196214147263  título   resuelto   Poster Collection
196214146242  título   ELECCIÓN   2 candidatas
196214145016  título   ELECCIÓN   3 candidatas

RESUELTOS: 4    REQUIERE ELECCIÓN: 4
```

Cuatro y cuatro, que era exactamente el criterio.

`banpresto.astro` y `funko-pop.astro` siguen sin aparecer en `git status`.

---

## Deuda que queda para la fase 4

`render.ts` quedó limpio: dibuja recorriendo `adapter.fields` en las cinco partes
donde antes tenía campos fijos.

`export.ts` no. Siguen cableados:

```ts
// línea 210
const customLabel0 = item.expansion || (item as any).license || '';
// línea 211
const customLabel1 = item.variant || (item as any).boxNumber || '';
// líneas 302 y 303: columna fija "Expansión" en la tabla HTML
// línea 471: p.expansion fijo en el CSV general
```

El `expansion || license || boxNumber` es el whack-a-mole que ya habíamos
señalado, solo que ahora concentrado en un archivo en vez de dos.

No bloquea nada hoy y la herramienta funciona. **Es lo primero que hay que
resolver al abrir la fase 4**, antes de migrar Banpresto y Funko, porque si no
cada línea nueva agrega su propio `|| algo` a esas mismas cuatro líneas.

La forma correcta es la misma que se usó en `render.ts`: que el adaptador declare
sus columnas de exportación, y `export.ts` las recorra sin saber cuáles son.

---

## Pendiente para Felipe

1. `npm run build` en la máquina local.
2. Abrir `/tools/pokemon-tcg` en el preview y correr la muestra: tienen que
   quedar cuatro fichas resueltas y cuatro pidiendo variante. Elegir una,
   recargar la página, y confirmar que la elección sobrevivió.
3. Confirmar que Banpresto y Funko siguen resolviendo un lote como antes.
4. `.\commit.ps1 evo.cl "Pokemon TCG scraper fase 3"`.
5. Configurar `INDEX_SECRET` en Netlify, si no se hizo antes.
6. Después del deploy, confirmar en los logs que la corrida programada ejecutó y
   que el badge de la página muestra la fecha nueva sola, sin recompilar el sitio.

El punto 6 es el que cierra de verdad el tema de la frescura del índice, que se
rompió por tres vías distintas antes de llegar acá.

---

## Siguiente

Fase 4: migrar Banpresto y Funko al núcleo, empezando por dejar `export.ts`
manejado por el adaptador. Criterio: las dos herramientas dan exactamente el
mismo resultado que hoy en un lote de control guardado antes de migrar.

Fase 6 sigue bloqueada hasta que se pueda correr `sonda-html-sphinx.html`.
