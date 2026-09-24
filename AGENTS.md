# AGENTS.md — reglas del repo evo.cl

Lo leen Cowork, Antigravity y Cursor.

## Cómo trabajamos

Felipe aprueba, el agente implementa. No hacer commit ni push sin que Felipe lo
pida.

Planificar antes de programar. Para cualquier cambio que toque más de un archivo
o meta un servicio externo, escribir el plan y esperarlo aprobado. Felipe revisa
esos planes con un segundo agente antes de aprobar, así que el plan debe explicar
el diseño, no solo los pasos.

Si una decisión anterior resultó equivocada, mejor cambiarla que defenderla, pero
explicar qué cambió y por qué.

Cuando el plan de una tarea vive en un archivo del repo (en `_context/`, `docs/`,
o donde ese proyecto lo defina), ese archivo manda: es la fuente del alcance y los
criterios de aceptación, no lo que se resuma en el chat o en el mensaje corto que
lo señale.

Idioma español para comentarios, commits y textos de interfaz. Sin em dash.

## Reglas técnicas de la casa

Salieron de errores reales, no de teoría.

1. **Nunca guardar estado por posición.** Si algo se guarda como "el elemento
   número 3 de la lista", se rompe en silencio apenas la lista cambia de orden o
   le agregan algo. Usar identificadores fijos y explícitos, guardados junto al dato.

2. **`readdirSync` no ordena igual en Windows que en Linux.** Windows ignora
   mayúsculas, Linux las pone primero, y el deploy corre en Linux. Ordenar
   cualquier lista generada leyendo un directorio de forma explícita.

3. **Verificar fin de línea antes de cada commit.** Correr
   `git diff --stat --ignore-all-space`. Si sale vacío mientras `git diff --stat`
   muestra archivos, son solo finales de línea y no se commitean. Cada repo debe
   tener un `.gitattributes` con `* text=auto eol=lf`. Commitear ese ruido rompe
   `git blame` de forma permanente.

4. **Todo lo que guarda trabajo del usuario se autoguarda.** Nada de un botón de
   "guardar" como única vía. Guardar solo, con respaldo local y reintento ante
   fallo de red. Al recuperar estado, nunca sobrescribir a ciegas: comparar con
   el respaldo local y conservar lo que tenga más trabajo.

5. **Probar la segunda sesión, no solo la primera.** Que funcione al hacer clic
   no basta. ¿Qué pasa si el usuario cierra y vuelve mañana? ¿Si cambian los
   datos de entrada? ¿Si esto corre dos veces? ¿En Linux si lo probé en Windows?

6. **Los scripts que regeneran datos son idempotentes.** Correrlos dos veces
   seguidas debe dar el mismo archivo.

7. **Verificar el formato real de las imágenes**, no la extensión. Las fotos de
   clientes llegan con extensiones mentirosas (un HEIC llamado `.WEBP`).

8. **Servicios externos: avisar antes de integrarlos**, con su modo de falla
   explicado. Si es gratuito sin garantía, tiene que existir una copia local del dato.

## Antes de dar algo por terminado

- [ ] El build pasa sin errores ni warnings nuevos
- [ ] `git diff --stat --ignore-all-space` muestra solo lo que tocaste
- [ ] Si cambiaste un script de datos, lo corriste dos veces y da lo mismo
- [ ] Si cambiaste algo que guarda estado, probaste recargar
- [ ] La documentación del proyecto quedó al día si cambió la arquitectura

---

## Específico de evo.cl

Astro más Netlify Functions. `src/pages/` son las páginas, `netlify/functions/`
las funciones serverless en TypeScript (`.mts`).

Los planes de tarea viven en `_context/<proyecto>/PLAN.md`. Ese archivo manda
sobre cualquier resumen de chat.

### Herramientas de catálogo

`/tools/banpresto`, `/tools/funko-pop` y `/tools/vectorizer` están en producción
y las usa WePlay a diario. No se tocan sin lote de control comparado antes y
después.

Las dos primeras comparten hoy cerca del 60% de su código por copia. Hay un plan
de consolidación en `_context/pokemon-tcg/PLAN.md`. Cualquier herramienta nueva
de catálogo se construye sobre ese núcleo compartido, no copiando un archivo
existente.

### Fuentes externas de datos

Todas son gratuitas y sin garantía, así que aplica la regla 8 de arriba.
Estado verificado al 16-09-2026:

- `tcgcsv.com`, volcado público del catálogo de TCGplayer. Abierto, sin llave.
- Tiendas Shopify, endpoints `/products.json` y `/search/suggest.json`. Abiertos.
- `api.upcitemdb.com`, plan de prueba. Sirve para Funko, devuelve vacío para
  Pokémon.
- `pokemon.com` y todos sus subdominios. **Bloqueados por Imperva.** No
  reintentar, no buscar rodeos.

Antes de agregar una fuente nueva, probarla contra códigos reales y anotar el
resultado acá.

### Build

`npm run build`. El sandbox de Cowork no puede correr `npm install` de forma
confiable sobre el mount, así que la verificación de build la hace Felipe en su
máquina antes del push. Un agente no debe afirmar que el build pasa si no lo
corrió.
