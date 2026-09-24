# Revisión 2, correcciones de fases 1 y 2

**Fecha:** 2026-09-16
**Revisó:** Cowork, sobre el código y el índice regenerado.
**Veredicto:** los tres bloqueantes quedaron resueltos. Aparecieron dos cosas
nuevas, una de ellas introducida por estas mismas correcciones.

---

## Verificado punto por punto

| Corrección | Estado | Evidencia |
|---|---|---|
| 1. `generatedAt` real | **OK** | `2026-09-16T21:03:58.805Z` en el índice |
| 2. Descripciones en el índice | **OK** | 2.614 de 2.977 productos con texto, máximo 2.310 caracteres, ninguno cortado con "..." |
| 3. `verifyShopifyMatch` | **OK con reserva** | Rechaza los 4 falsos positivos. Ver hallazgo A |
| 4. `buildFichaHtml` fuera del adaptador | **OK** | Ya no existe en `src/lib/catalog/` |
| 5. Filtro de sellado | **OK** | 0 cartas con numeración, `Lucky Stadium` y `Ace Trainer` fuera |
| 6. Schedule y lote | **OK con reserva** | `@daily`, `INDEX_SECRET`, lotes de 10, `forceRefresh`. Ver hallazgo F |
| 7. Higiene | **OK** | `.gitattributes` creado, `public/_redirects` ya no aparece en el diff |
| 8. `calculateJaccard` genérica | **OK** | Penalizaciones de `case` y `center` movidas al adaptador |

Extra no reportado y correcto: se eliminó el piso artificial `Math.max(score, 0.8)`
en los candidatos que comparten UPC. Ahora el orden entre variantes refleja
puntajes reales.

**El motor de matching no sufrió regresión.** Volví a correr los 4 SKU en español
con la lógica nueva contra el índice nuevo y da idéntico a antes: 704143 y 704153
en 1.000 con candidato único, las dos ex Box empatadas en 0.950, las tres Tech
Sticker con Lucario en 0.983.

**El guardia sí sirve.** Probé los 4 casos que fallaban, contra las tiendas en vivo:

| Consulta | Candidato devuelto | Resultado |
|---|---|---|
| Sylveon ex Box | Sylveon ex **Tin** (pokemillon) | rechazado, tipo incompatible |
| Sylveon ex Box | Binder en chino (todohits) | rechazado, idioma |
| Elite Trainer Box | ETB **Caos Creciente** (todohits) | rechazado, expansión |
| Poster Collection | Blister 3 Sobres (todohits) | rechazado, falta Poster |

Cuatro de cuatro falsos positivos eliminados.

---

## A. La tabla de sinónimos bilingües no hace nada, y bota los aciertos

`BILINGUAL_SYNONYMS` está escrita como intercambio recíproco, no como
canonicalización:

```ts
celebration: 'celebraciones',
celebraciones: 'celebration',
```

`normalizeBilingualToken` se aplica a los dos lados. El origen dice
"celebration" y se convierte en "celebraciones". El candidato dice
"celebraciones" y se convierte en "celebration". **Se cruzan y siguen sin
coincidir.** Lo mismo pasa con `box`/`caja`, `sticker`/`pegatina`,
`anniversary`/`aniversario` y `30th`/`30`. La capa de sinónimos es inerte.

El efecto es que el guardia también rechaza los candidatos correctos:

| Par real | Jaccard hoy | Jaccard con tabla canónica |
|---|---|---|
| `30th Celebration Elite Trainer Box` vs `ETB Celebraciones 30 Aniversario \| Élite Celebrations 30th` | **0.20 rechazado** | 0.50 |
| `30th Celebration Poster Collection` vs `30th Poster Collection Box Celebraciones 30 Aniversario` | 0.38 apenas pasa | 0.82 |
| `30th Celebration Tech Sticker Collection [Lucario]` vs `Blíster Lucario Tech Sticker Celebraciones 30 Aniversario` | 0.30 a 0.36, en el filo | 0.62 |

Umbral actual: 0.35.

O sea el enriquecimiento en español quedó de hecho apagado: el ETB en español,
que es el candidato correcto y existe en pokemillon, se descarta. Y los dos que
pasan lo hacen por centésimas.

Es un fallo seguro, mejor que pegar datos del producto equivocado, pero la
funcionalidad no está entregada.

**Corrección:** que los dos idiomas mapeen a una misma clave compartida, no uno
al otro.

```ts
const BILINGUAL_SYNONYMS = {
  celebration: 'celeb', celebrations: 'celeb',
  celebraciones: 'celeb', celebracion: 'celeb',
  anniversary: 'aniv', aniversario: 'aniv',
  box: 'box', caja: 'box',
  sticker: 'stk', pegatina: 'stk',
  '30th': '30', '30': '30',
  elite: 'elite', etb: 'elite',
};
```

Con esa tabla los tres pares quedan en 0.50, 0.82 y 0.62, y el umbral de 0.35
deja de estar en el filo. Revisar el umbral recién después de arreglar esto.

---

## B. El tope de 1.0 deja que el bono finja una coincidencia exacta

Esto lo introdujeron estas correcciones. `calculateJaccard` pasó de
`Math.min(0.99, score)` a `Math.min(1.0, score)`.

El bono de contención suma 0.15 cuando todos los tokens de la consulta están en
el producto. Con el tope en 0.99, un match no exacto nunca podía llegar a 1.0.
Con el tope en 1.0, sí puede.

Importa porque el adaptador usa 1.0 como señal de "exacto":

```ts
if (topScore >= 1.0 && (scored.length === 1 || scored[1].score < 1.0)) {
  matchedEntries = [scored[0]];   // candidato único, sin selector de variante
}
```

Busqué en el índice cuántos pares llegan a exactamente 1.0 por bono sin ser
exactos: **116**. Ejemplos:

- `Sword & Shield Elite Trainer Box [Zacian]` contra `Sword & Shield Elite Trainer Box Plus [Zacian]`
- `Battle Arena Deck: Ultra Necrozma GX` contra `Battle Arena Deck: Ultra Necrozma GX & Rayquaza GX`
- `Detective Pikachu: Charizard GX Case File` contra `Detective Pikachu: Charizard GX Special Case File`

Cuando el producto verdadero también está en el índice, los dos dan 1.0 y el
atajo no se dispara, así que se muestran ambos. El problema es cuando el producto
verdadero **no** está indexado, que es justo el caso de las ediciones en español:
entonces un superconjunto marca 1.0 solo, el atajo lo toma como candidato único y
la herramienta entrega con total confianza un producto parecido pero distinto,
sin ofrecer el selector de variantes.

**Corrección:** devolver el tope a 0.99 para todo lo que no sea igualdad exacta
de conjuntos de tokens. Es un carácter, y el 1.0 vuelve a significar lo que dice.

---

## C. El rechazo por inglés está muerto

`FOREIGN_LANG_MARKERS` incluye `'ingles'` y `'english'`, y la verificación es
`candSet.has(marker)` sobre el resultado de `extractTokens`. Pero `STOP_WORDS` en
`utils.ts` ya elimina `'english'` y `'ingles'` antes. Esos dos marcadores nunca se
pueden cumplir.

`chino`, `japones`, `coreano` y sus equivalentes en inglés sí funcionan, porque no
están en las stop words. Se probó en vivo: el binder chino se rechaza.

**Corrección:** comparar los marcadores de idioma contra el título normalizado
completo, no contra los tokens filtrados.

---

## D, E, F. Menores

**D. El guardia de expansión está cableado al 30 Aniversario.** La validación
pregunta por `30th` o `celebration` en el origen, y además lleva una lista negra
de tres nombres de expansión en español. Funciona hoy y deja de proteger sola en
la próxima expansión. Debería comparar contra el `groupName` del propio producto,
que ya viene en el índice, en vez de una lista escrita a mano.

**E.** `descriptionHtml` y `descriptionHtml_en` siguen declarados en
`types.ts` aunque ya nada los produce. Sacarlos para que la fase 6 no asuma que
existen.

**F. `INDEX_SECRET` falla abierto.** La verificación corre solo `if (secret)`. Si
la variable no está configurada en Netlify, el endpoint queda público y cualquiera
puede gatillar 220 peticiones contra TCGCSV. Debería ser al revés: sin secreto
configurado, rechazar la invocación manual y dejar solo el schedule.

Aparte, confirmar en el deploy que Netlify acepta `@daily` en `config.schedule`.
Si no, usar `0 6 * * *` o similar.

---

## Orden de corrección

1. Tabla de sinónimos canónica (hallazgo A). Es lo que desbloquea el español.
2. Tope de vuelta a 0.99 (hallazgo B).
3. Marcadores de idioma contra el título completo (hallazgo C).
4. Guardia de expansión por `groupName` (hallazgo D).
5. `INDEX_SECRET` que falle cerrado, y limpiar `types.ts`.

Nada de esto toca el índice ni el motor de matching, que quedaron bien.
Después de 1 y 2, volver a correr los 8 SKU y reportar, para cada uno de los 4 en
español, si se enriqueció y con qué título de tienda.
