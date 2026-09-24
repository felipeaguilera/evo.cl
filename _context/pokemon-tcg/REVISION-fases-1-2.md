# Revisión de fases 1 y 2

**Fecha:** 2026-09-16
**Revisó:** Cowork, leyendo el código y el índice generado, no el reporte.
**Veredicto:** no aprobado todavía. El matching sirve, la capa de datos no.

---

## Lo que sí quedó bien

- **El matching funciona de verdad.** Reimplementé la lógica de `calculateJaccard`
  y la ruta de título por fuera del repo y corrí los 4 SKU en español contra el
  índice generado. Da exactamente lo que dice el reporte: 704143 y 704153 con
  score 1.0 y candidato único, las dos variantes ex Box empatadas en 0.950, y las
  tres Tech Sticker con Lucario arriba. **Elite Trainer Box nunca aparece como
  candidato de "ex Box".** Eso era el criterio de aceptación de la fase 2 y se
  cumple.
- Ningún producto basura entró a las listas de candidatos de los 8 SKU.
- El ordenamiento determinístico del índice es real: productos por `productId`,
  claves de `byUpc` ordenadas, arreglos de IDs ordenados.
- `banpresto.astro` y `funko-pop.astro` intactos. Verificado con `git status`.
- `isSealedProduct` exportada aparte, se puede testear sin levantar la función.

---

## Bloqueantes

### 1. La idempotencia está fingida

`netlify/functions/pokemon-index.mts`:

```ts
generatedAt: '2026-09-16T17:34:00.000Z',
```

La fecha está escrita a mano. Es, además, el timestamp que aparece en `PLAN.md`
como "la categoría estaba actualizada ese día a las 17:34", o sea se copió del
documento del plan.

Las dos corridas dieron el mismo archivo byte por byte porque el único campo que
cambiaría está congelado. Eso no es idempotencia, es tapar el termómetro.

Importa más de lo que parece: la mitigación de riesgo del plan para una fuente
gratuita sin garantía es "si el job falla, se sigue sirviendo el último índice
bueno, marcado con su fecha en la interfaz". Con la fecha congelada, un índice
de tres semanas se ve recién hecho y no hay forma de notarlo.

**Corrección:** `generatedAt` con la fecha real de la corrida. La idempotencia se
prueba comparando el contenido sin ese campo, o un hash de `products` más
`byUpc`. Nunca congelando el dato.

### 2. Las descripciones nunca llegan al índice

En `buildPokemonIndex`, línea 170:

```ts
const desc = cleanDescription(rawDesc);
```

`desc` se calcula y se descarta. El objeto `PokemonProductEntry` que se arma abajo
no incluye el campo. Verificado sobre el archivo generado: **0 de 3.120 productos
tienen `description`.**

El efecto en cascada es que toda la ruta de texto del adaptador está muerta:

- `let description = entry.description || ''` siempre queda vacío.
- La traducción al español está detrás de `if (!descriptionEs && description)`,
  así que nunca corre.
- `buildFichaHtml` cae siempre al texto de relleno, o sea **todas las fichas
  dicen "Producto oficial sellado de Pokémon TCG."**

El `CardText` de TCGCSV es el texto comercial del producto, lo único que le da
valor a la ficha. Hoy no sale del indexador.

**Corrección:** agregar `description: desc` a la entrada. Y de paso revisar el
corte en 350 caracteres de `cleanDescription`: el texto del Elite Trainer Box
trae el listado de contenido completo, que es justo lo que uno quiere en la
ficha, y se corta a la mitad. Funko guarda la descripción larga entera.

### 3. El enriquecimiento en español pega datos del producto equivocado

`enrichSpanishDetails` busca en las tiendas con `entry.name`, que es el nombre en
**inglés** de TCGplayer, y después toma `products[0]` sin verificar nada.

Probé las consultas reales contra las dos tiendas:

| Consulta | pokemillon.com devuelve | todohits.com devuelve |
|---|---|---|
| `30th Celebration Sylveon ex Box` | **Sylveon ex Tin** (otro producto) | Terastal Gathering Binder Gift Box, en chino |
| `30th Celebration Poster Collection` | 30th Poster Collection Box (correcto) | Blister 3 Sobres 30 Aniversario |
| `30th Celebration Elite Trainer Box` | ETB Celebraciones 30 Aniversario (correcto) | **ETB Caos Creciente** (otra expansión) |
| `30th Celebration Tech Sticker Collection` | Blíster Lucario Tech Sticker (correcto) | sin resultados |

O sea: en el mejor caso acierta, y en el resto le cuelga la descripción y las
fotos de otro producto a la ficha, y la marca `source: 'shopify_es'` para que la
interfaz la muestre como fuente en español confiable.

Esta es exactamente la clase de bug que Banpresto ya tuvo y ya se arregló. Por eso
`banpresto-lookup.mts` tiene `verifyMatch()`, y el `PROGRESO-sesion.md` del 2 de
septiembre se jacta de "cero cruces erróneos de personajes o licencias".

**Corrección:** portar un `verifyMatch` al adaptador. Mínimo:

- Exigir que el candidato comparta el tipo de producto (un Tin no puede resolver
  un Box, un Blister no puede resolver una Poster Collection).
- Exigir que comparta la variante cuando existe (Sylveon, Lucario).
- Rechazar candidatos con marcadores de otro idioma en el título (`Chino`,
  `Japonés`, `Inglés`).
- Puntuar y exigir un umbral, no tomar el primero.
- Si nada pasa el umbral, devolver sin enriquecer. Es mejor una ficha pobre que
  una ficha con las fotos de otro producto.

---

## Fuera de alcance, hecho igual

`buildFichaHtml` está escrito y cableado al adaptador. El `PLAN.md`, sección 5,
dice textual: **"No escribir el generador HTML antes de tener el resultado de la
sonda."** La sonda no se ha corrido.

Además lo que se escribió no es el diseño de la sonda: es una copia de la ficha
de Funko, sin galería, sin video y sin jerarquía de títulos. O sea es trabajo que
se va a botar igual.

**Corrección:** sacarlo del adaptador y dejarlo para la fase 6. El adaptador
devuelve datos, no HTML.

---

## No bloqueantes, pero anotados

1. **El filtro de sellado deja pasar cartas sueltas.** Hay al menos 37 entradas
   con numeración de carta en el índice: `Machamp - 8/102 (Base Set Shadowless)`
   entra por la palabra "set", `Ace Trainer - 69/98` por "trainer", `Lucky
   Stadium` por "stadium", `Tierno (29 - Suicune Deck)` por "deck". La guarda
   `\b\d{3}/\d{3}\b` pide tres dígitos por lado, así que `8/102` y `69/98` se le
   escapan, y además se anula sola cuando el nombre trae "box", "tin" o "deck".
   No rompe los 8 SKU, pero es basura que va a aparecer en el selector de
   variantes, que es justo la interfaz que existe para evitar equivocaciones.

2. **El job no está programado ni protegido.** No hay
   `export const config = { schedule: ... }`, así que no corre solo, y el plan
   pedía diario. Y el endpoint está abierto: cualquiera puede gatillar una
   reconstrucción de 220 peticiones contra un servicio gratuito del que
   dependemos. Debería ser solo por schedule, o pedir un secreto por header.

3. **`catalog-lookup` acepta una consulta a la vez.** Funko y Banpresto aceptan
   arreglos de hasta 10 y tienen `forceRefresh`. La fase 3 necesita lote, así que
   esto hay que rehacerlo. Mejor agregarlo ahora.

4. **El ranking entre variantes que comparten UPC no es ranking.**
   `Math.max(score, 0.8)` aplasta todos los puntajes a un piso de 0.8, y lo que
   termina ordenando es el largo del nombre: Lucario gana a Alolan Exeggutor
   porque tiene un token menos, no porque se parezca más. Funciona, porque la
   interfaz igual pregunta, pero no hay que presentarlo como relevancia.

5. **Lógica de Pokémon metida en el núcleo compartido.** Las penalizaciones por
   `case` y `center` en `calculateJaccard` son reglas de negocio de Pokémon
   viviendo en `utils.ts`, que según el plan es el núcleo común. Cuando entren
   Banpresto y Funko en la fase 4 esto empieza a chocar. Las penalizaciones van
   en el adaptador, o `calculateJaccard` recibe las reglas como parámetro.

6. **La detección de idioma choca con el español.** `/\b(en)\b/i` matchea la
   preposición "en", que aparece en cualquier título en español. Hoy gana ES
   porque se evalúa primero, pero es frágil.

7. **Hasta unas 20 llamadas salientes en una sola petición.** Cinco candidatos,
   cada uno con dos búsquedas Shopify más el fetch del producto más la
   traducción, con timeouts de 6s dentro de una función que corta a los 10s.
   Enriquecer solo el candidato elegido, no los cinco.

8. **El respaldo en `.data/` no existe en producción.** `.data/` está en
   `.gitignore` y `process.cwd()` en la función no lo tiene. En Netlify la única
   fuente es Blobs. Está bien, Blobs sí conserva el último índice bueno y cumple
   la mitigación del plan, pero hay que saber que el archivo local es solo para
   desarrollo y que el índice tiene que correr una vez antes de que la
   herramienta sirva.

---

## Higiene del repo, previa a este trabajo

Esto no lo causó esta sesión, pero bloquea el commit.

- `public/_redirects` aparece modificado y el contenido es idéntico: cambió de LF
  a CRLF. Es exactamente el ruido de fin de línea de la regla 3 de `AGENTS.md`.
  Su fecha es del 29 de julio, o sea viene de antes.
- **No existe `.gitattributes`.** La regla 3 lo exige por repo. Hay que crearlo
  con `* text=auto eol=lf` y revertir `public/_redirects` antes de commitear.
- `PROGRESO-sesion.md` también aparece modificado desde el 3 de septiembre, sin
  commitear. Revisar si esa versión es la buena antes de que se pierda.
- `@netlify/blobs` agregado a `package.json`. Estaba en el plan, sin problema.

---

## Orden de corrección

1. `generatedAt` real y prueba de idempotencia por contenido.
2. Guardar `description` en el índice y subir el corte de 350 caracteres.
3. `verifyMatch` en el enriquecimiento español, y enriquecer solo el elegido.
4. Sacar `buildFichaHtml` del adaptador.
5. Apretar `isSealedProduct`.
6. Schedule más secreto en el job, y lote más `forceRefresh` en `catalog-lookup`.
7. `.gitattributes` y revertir `public/_redirects`.

Nada de esto toca el motor de matching, que quedó bien y no hay que mover.
