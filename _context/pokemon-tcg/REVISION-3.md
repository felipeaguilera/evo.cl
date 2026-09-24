# Revisión 3

**Fecha:** 2026-09-16
**Veredicto:** los seis hallazgos de la revisión 2 quedaron resueltos y verificados.
Queda **un bug nuevo**, introducido por la corrección F, que deja el job diario sin
correr nunca.

---

## Verificado

| Hallazgo rev. 2 | Estado | Evidencia |
|---|---|---|
| A. Sinónimos bilingües recíprocos | **OK** | Tabla canónica, y ampliada con `collection`/`coleccion`, `binder`/`album`, plurales |
| B. Tope de 1.0 fingiendo exacto | **OK** | Vuelto a `Math.min(0.99, score)`. Cero pares no exactos llegan a 1.0 |
| C. Marcadores de idioma muertos | **OK** | Ahora se comparan con regex contra el título normalizado completo, no contra tokens |
| D. Guardia de expansión cableado | **OK** | Reemplazado por comparación contra `groupName` con tokens canónicos. La lista negra de nombres desapareció |
| E. `descriptionHtml` huérfano | **OK** | Fuera de `types.ts` |
| F. `INDEX_SECRET` falla abierto | **Corregido pero rompe el schedule**, ver abajo |

### El enriquecimiento en español ahora sí funciona

Probado contra las tiendas en vivo, con la lógica nueva completa:

| Producto | Tienda | Resultado |
|---|---|---|
| Elite Trainer Box | pokemillon: *ETB Celebraciones 30 Aniversario* | **acepta**, jaccard 0.50 |
| Poster Collection | pokemillon: *30th Poster Collection Box Celebraciones* | **acepta**, jaccard 0.82 |
| Tech Sticker [Lucario] | pokemillon: *Blíster Lucario Tech Sticker Celebraciones* | **acepta**, jaccard 0.62 |
| Elite Trainer Box | todohits: *ETB Caos Creciente* | rechaza, expansión |
| Poster Collection | todohits: *Blister 3 Sobres* | rechaza, falta Poster |
| Sylveon ex Box | pokemillon: *Sylveon ex **Tin*** | rechaza, tipo |
| Sylveon ex Box | todohits: binder en chino | rechaza, idioma |

Tres aciertos aceptados con margen cómodo, cuatro falsos positivos rechazados.
Son exactamente los valores proyectados en la revisión 2. El Sylveon ex Box queda
sin enriquecer porque pokemillon solo tiene la lata, y eso está bien: sin dato es
mejor que con el dato de otro producto.

### El matching sigue sin regresión

Los 4 SKU en español dan lo mismo que en las dos revisiones anteriores: 704143 y
704153 con candidato único en 1.00, las dos ex Box en 0.95, las tres Tech Sticker
con Lucario en 0.98.

---

## G. El job diario nunca va a correr

`pokemon-index.mts` tiene `config.schedule = '@daily'` y, en el handler,
exige autorización **para toda invocación**, sin distinguir de dónde viene:

```ts
const isAuthorized = Boolean(secret && (authHeader === `Bearer ${secret}` || ...));
if (!isAuthorized) { return new Response(..., { status: 401 }); }
```

La documentación de Netlify dice dos cosas que juntas rompen esto:

1. Una función programada **no se puede invocar por URL**. El endpoint público no
   existe.
2. La invocación programada entra por el mismo `export default async (req)`, con
   un cuerpo JSON que trae `next_run`, y **sin cabecera de autorización**.

Entonces: el único camino de invocación que existe es el del schedule, y ese
camino choca con el 401 antes de llegar a `buildPokemonIndex()`. El índice se
queda congelado en la corrida manual y nunca se actualiza. Es el mismo problema
de frescura que arreglamos en la revisión 1 con `generatedAt`, entrando por otra
puerta.

Además, como la función no es alcanzable por URL, `INDEX_SECRET` no protege nada.
Es un candado en una puerta tapiada.

**Corrección, una de dos:**

- **Simple:** sacar el bloque de autorización. La función programada ya está
  cerrada al público por el propio Netlify.
- **Si quieren gatillo manual:** dejar `pokemon-index.mts` solo con el schedule y
  sin auth, y crear una segunda función sin `config.schedule`, por ejemplo
  `pokemon-index-run.mts`, que sí exija `INDEX_SECRET` y llame a
  `buildPokemonIndex()`. Esa sí es alcanzable por URL y sí necesita el candado.

En cualquier caso, después del deploy hay que confirmar en los logs de Netlify que
la corrida programada ejecutó y que `generatedAt` cambió.

---

## Notas menores, no bloqueantes

1. **`@daily` corre a las 00:00 UTC**, o sea 21:00 en Chile del día anterior. Si
   prefieren que el índice se refresque de madrugada hora local, usar
   `0 9 * * *`. Es indiferente para el funcionamiento, pero conviene saberlo.

2. **El índice en disco es de la corrida anterior** (`generatedAt` 21:03:58).
   Ninguna de estas correcciones cambia el contenido del índice, así que sigue
   siendo válido, pero después de arreglar G hay que regenerarlo y confirmar que
   la fecha cambia.

3. **El guardia de expansión acepta con un solo token en común.** Para
   `ME: 30th Celebration` los tokens canónicos son `30` y `celeb`, y basta uno.
   Un candidato que solo diga "30" pasa esta etapa. Hoy no importa porque las
   etapas de tipo, variante y Jaccard lo atajan después, pero si más adelante se
   relaja el umbral de 0.35 hay que revisar esto.

4. **Falta el filtro `sv08` y similares** en la lista de prefijos ignorados del
   `groupName` (hoy filtra `me`, `sv`, `swsh`, `promo`, pero los códigos reales
   vienen pegados como `sv08`). Aplica cuando entren expansiones más viejas.

---

## Para cerrar fases 1 y 2

1. Arreglar G.
2. Regenerar el índice y confirmar que `generatedAt` cambia.
3. Correr los 8 SKU y reportar cuáles de los 4 en español se enriquecieron y con
   qué título de tienda.
4. Felipe corre `npm run build` en su máquina, `.\commit.ps1 evo.cl "..."`.

Con eso las fases 1 y 2 quedan cerradas y se puede entrar a la fase 3.
