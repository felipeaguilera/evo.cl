# Reporte de Progreso de Sesión — Banpresto Scraper & Sphinx ERP (Actualizado v2)

**Fecha:** 2026-09-02  
**Autor:** Antigravity (EVO Creative Lab)  
**Proyecto:** EVO-Dev/evo.cl (Astro + Netlify Functions)  
**Cliente:** 21.12 Weplay  

---

## 1. Resumen de Cambios Recientes (Gestión y Preservación de Precio Real)

Se corrigió la pérdida de precio solicitada por Felipe:

1. **Soporte de Input de 3 Campos (`JAN | Título | PVP`):**
   - El parser (`parseInputItem`) ahora acepta strings de 3 campos separados por pipe (`|`) o tabulación (`\t` desde Excel), o payloads JSON con `{ jan, title, price / pvp }`. Mantiene 100% de compatibilidad hacia atrás con inputs de 2 campos (`JAN | Título`) o códigos sueltos.
2. **Prioridad Estricta de Precio (Price Overriding Rule):**
   - Si el input trae su propio precio (columna `PVP (C/IVA)` de WePlay), **ese valor manda siempre** sobre cualquier precio raspado de tiendas externas (Distrito Max, etc.).
   - Si no viene precio en el input, se puede mostrar el precio raspado como referencia.
   - Si no hay precio en ninguna parte, el campo queda vacío o marcado `"Sin precio"`, **nunca un placeholder inventado (se eliminó el valor fijo hardcodeado de $29.990)**.
3. **Muestra y Exportación Completa:**
   - Visualización en la tarjeta (grid de especificaciones).
   - Inclusión en la ficha técnica estandarizada HTML (`<li><strong>Precio de Venta (PVP):</strong> ...</li>`).
   - Columna dedicada `Precio PVP` en la tabla formateada para Google Sheets / Excel.
   - Columna `Precio PVP` en la exportación a CSV General.
   - Formato en el copiado rápido de texto.
4. **Actualización de Muestras:**
   - Se actualizaron los `SAMPLE_ITEMS` en `src/pages/tools/banpresto.astro` con los precios reales de la hoja `PRODUCTOS` de WePlay (incluyendo figuras de $29.990, $79.990, etc.).

---

## 2. Benchmark v2 con Precios Reales (15 Filas del Contenedor)

Probado contra las 15 filas reales con el backend `netlify/functions/banpresto-lookup.mts`:

| # | Item No. | JAN | Título en Excel / Factura | PVP Real WePlay | Resultado | Fuente | Galería | Precio Preservado |
|---|---|---|---|---|---|---|---|---|
| 1 | 69762 | 4573102697622 | Hell Teacher: Jigoku Sensei Nube Meisuke Nueno FIGURE | $29.990 | ❌ No indexado | — | 0 | ✅ $29.990 |
| 2 | 69763 | 4573102697639 | Hell Teacher: Jigoku Sensei Nube Kyosuke Tamamo FIGURE | $29.990 | ❌ No indexado | — | 0 | ✅ $29.990 |
| 3 | 71152 | 4573102711526 | Hell Teacher: Jigoku Sensei Nube GLITTER&GLAMOURS Yukime | $29.990 | ❌ No indexado | — | 0 | ✅ $29.990 |
| 4 | 71553 | 4573102715531 | Shin Godzilla Monster Roah Attack eXtra Large Godzilla(2016)4th.Form | **$79.990** | ✅ Encontrado | Little Buddy | 1 foto HD | ✅ **$79.990** |
| 5 | 71341 | 4573102713414 | JUJUTSU KAISEN MAXIMATIC YUJI ITADORI-The culling game?- | $29.990 | ✅ Encontrado | DistritoMax | 4 fotos HD | ✅ $29.990 |
| 6 | 71342 | 4573102713421 | JUJUTSU KAISEN MAXIMATIC MEGUMI FUSHIGURO-The culling game?- | $29.990 | ✅ Encontrado | DistritoMax | 4 fotos HD | ✅ $29.990 |
| 7 | 71101 | 4573102711014 | Dragon Ball Z Match Makers Super Saiyan Gogeta | $29.990 | ✅ Encontrado | DistritoMax | 4 fotos HD | ✅ $29.990 |
| 8 | 71102 | 4573102711021 | Dragon Ball Z Match Makers Janemba | $29.990 | ✅ Encontrado | Little Buddy | 1 foto HD | ✅ $29.990 |
| 9 | 71321 | 4573102713216 | NARUTO Shippuden Grandista Uzumaki Naruto#3 | $29.990 | ✅ Encontrado | DistritoMax | 5 fotos HD | ✅ $29.990 |
| 10 | 71322 | 4573102713223 | NARUTO Shippuden Grandista Uchiha Sasuke#3 | $29.990 | ✅ Encontrado | DistritoMax | 5 fotos HD | ✅ $29.990 |
| 11 | 71450 | 4573102714503 | ONE PIECE DXF THE GRANDLINE SERIES EXTRA MONKEY.D.LUFFY GEAR5 | $29.990 | ✅ Encontrado | Little Buddy | 1 foto HD | ✅ $29.990 |
| 12 | 71451 | 4573102714510 | ONE PIECE THE SHUKKO MONKEY.D.LUFFY | $29.990 | ✅ Encontrado | Little Buddy | 1 foto HD | ✅ $29.990 |
| 13 | 71288 | 4573102712882 | Spy x Family Break Time Collection Anya Forger & Bond Forger | $29.990 | ✅ Encontrado | Little Buddy | 1 foto HD | ✅ $29.990 |
| 14 | 71295 | 4573102712950 | Chainsaw Man Combination Battle Chainsaw Man | $29.990 | ✅ Encontrado | DistritoMax | 5 fotos HD | ✅ $29.990 |
| 15 | 71300 | 4573102713001 | Bleach Solid And Souls Ichigo Kurosaki II | $29.990 | ✅ Encontrado | Little Buddy | 1 foto HD | ✅ $29.990 |

- **Tasa de Acierto Global:** **80.0% (12 de 15 figuras encontradas)**.
- **Preservación de Precio Real:** **100%** (se verificó tanto para ítems estándar de $29.990 como ítems especiales tipo Godzilla XL de $79.990).
- **Precisión:** 100% (cero cruces erróneos de personajes o licencias).

---

## 3. Estado de Sphinx ERP (Nota Aparte)

- La persona de TI de WePlay ya no está en la empresa y el cargo está vacante; no hay soporte técnico por parte del cliente por ahora.
- **Decisión acordada:** El futuro cargador a Sphinx será un proyecto independiente (repositorio propio, no Netlify Function, probablemente script local montado en infraestructura propia).
- No se realizarán trabajos adicionales de RPA hasta tener acceso a Sphinx y verificar si existe un importador masivo de Excel/CSV en su módulo de inventario.
