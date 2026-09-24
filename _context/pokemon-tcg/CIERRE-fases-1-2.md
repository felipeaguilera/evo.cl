# Cierre de fases 1 y 2

**Fecha:** 2026-09-16
**Veredicto:** aprobado. Los criterios de aceptación de las fases 1 y 2 del
`PLAN.md` se cumplen y están verificados sobre el código y el índice, no sobre el
reporte.

---

## G resuelto, y bien

Tomaron la opción de dos funciones, que era la correcta:

- `pokemon-index.mts` conserva `config.schedule = '@daily'` y **ya no tiene
  bloque de autorización**. Es la ruta programada, y Netlify la mantiene cerrada
  al público por sí mismo.
- `pokemon-index-run.mts` es nueva, sin `schedule`, alcanzable por URL, y exige
  `INDEX_SECRET` con cabecera válida. Es el gatillo manual.

La segunda importa `buildPokemonIndex` de la primera y no reexporta su `config`,
así que no hereda el schedule. Correcto.

También cerraron la nota 4: la lista escrita a mano de prefijos de expansión se
reemplazó por `EXP_CODE_REGEX`, que cubre `me`, `sv`, `swsh`, `sm`, `xy`, `bw`,
`dp`, `ex` y `promo` con sus números.

---

## Verificación final

**Índice regenerado.** `generatedAt` pasó de `21:03:58` a `22:51:05`, con los
mismos 2.977 productos, 602 UPC y 2.614 descripciones. O sea la fecha se mueve y
el contenido no. Eso es la idempotencia que pedía el plan, ahora de verdad.

**Los 8 SKU resuelven.**

| SKU | Vía | Candidatos |
|---|---|---|
| 196214158801 | UPC | 1: 704143 |
| 196214158757 | UPC | 1: 704153 |
| 196214158771 | UPC | 3: Lucario 0.98, Alolan 0.86, Set of 2 0.86 |
| 196214158726 | UPC | 2: Sylveon 0.95, Greninja 0.95 |
| 196214144873 | título | 1: 704143 |
| 196214147263 | título | 1: 704153 |
| 196214146242 | título | 2: Sylveon 0.95, Greninja 0.95 |
| 196214145016 | título | 3: Lucario 0.98, Alolan 0.86, Set of 2 0.86 |

Elite Trainer Box no aparece como candidato de "ex Box" en ninguna de las dos
rutas. Ese era el criterio de la fase 2.

**Las descripciones traen contenido real.** 1.103 caracteres el Elite Trainer Box,
604 el Poster Collection, 569 el Sylveon ex Box, sin cortes.

**El enriquecimiento en español, contra tiendas en vivo:**

| Producto | pokemillon | todohits |
|---|---|---|
| Elite Trainer Box | acepta 0.50 | rechaza, expansión |
| Poster Collection | acepta 0.82 | rechaza, falta Poster |
| Sylveon ex Box | rechaza, tipo | rechaza, idioma chino |
| Tech Sticker [Lucario] | acepta 0.62 | rechaza, falta Sticker |

Tres aciertos con margen, cinco rechazos correctos. El Sylveon ex Box queda sin
enriquecer porque en esas tiendas solo está la lata, y ese es el comportamiento
deseado.

---

## Queda pendiente para Felipe

1. `npm run build` en la máquina local. Cowork no lo verifica en su sandbox y no
   lo va a afirmar.
2. `.\commit.ps1 evo.cl "Pokemon TCG scraper fases 1 y 2"`.
3. Configurar `INDEX_SECRET` en las variables de entorno de Netlify. Sin eso,
   `pokemon-index-run` responde 401 siempre, que es el comportamiento correcto
   pero deja sin gatillo manual.
4. Después del primer deploy, confirmar en los logs de Netlify que la corrida
   programada ejecutó y que `generatedAt` cambió sola. Es lo único que no se
   puede verificar antes de publicar.

---

## Notas que quedan abiertas, no bloqueantes

- `@daily` corre a las 00:00 UTC, o sea 21:00 hora Chile del día anterior. Si
  prefieren madrugada local, `0 9 * * *`.
- El guardia de expansión acepta con un solo token canónico en común. Hoy lo
  atajan las etapas de tipo, variante y Jaccard. Revisar si alguna vez se baja el
  umbral de 0.35.
- El respaldo en `.data/` es solo para desarrollo. En Netlify la única fuente es
  Blobs, así que el índice tiene que haber corrido una vez antes de que la
  herramienta sirva.

---

## Siguiente

Fase 3, la interfaz `/tools/pokemon-tcg`, según la sección 4 del `PLAN.md`. El
criterio es paridad funcional con Funko más el selector de variante, que tiene que
aparecer en los 4 SKU ambiguos y persistir la elección en el catálogo local.
