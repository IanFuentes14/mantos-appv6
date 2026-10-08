# Evaluación de capacidad de izaje

El módulo Izajes → Izaje compara dos límites independientes: eslingas y grúa. Es una evaluación de capacidad estática; no es una autorización operacional ni reemplaza el plan de izaje.

## Datos y cálculo

- Largos disponibles: 1,2 m, 4 m, 6 m y 10 m. El largo no cambia automáticamente la capacidad de la etiqueta.
- Referencia editable: Yagán plana, 50 mm, 2 capas, ASME 5:1; axial 2900 kg, lazo 2320 kg, canasta 5800 kg. Todos los largos requieren verificar su etiqueta y estado. La presencia de un largo en el selector no certifica ese producto.
- De 1 a 4 eslingas iguales. Se exige confirmar reparto equilibrado para varias eslingas. Cuatro se acreditan como tres para esta estimación conservadora; no se infiere una certificación de conjunto.
- Ángulo θ desde la horizontal entre 30° y 90°. Capacidad vertical por eslinga = capacidad de etiqueta del amarre × sen(θ). Una eslinga axial o en lazo aislada se considera vertical. Canasta requiere el ángulo de sus ramales incluso con una sola eslinga.
- Lazo exige confirmar estrangulación de al menos 120°; el ángulo de estrangulación no es θ. Otros casos quedan pendientes y requieren datos específicos.
- Demanda de eslingas = carga + accesorios que soportan. Demanda de grúa = demanda de eslingas + otras deducciones exigidas por su tabla. No duplicar pesos.
- Solo se muestra «Dentro de las capacidades ingresadas» cuando ambos límites cumplen y están completos los datos y verificaciones. No se aplica un margen operacional universal ni se multiplica por el factor de seguridad.

## Tablas compartidas

`src/lib/craneCatalog.js` alimenta tanto Izaje como Tablas de carga. Solo se usan puntos hidráulicos documentados, sin interpolar o extrapolar; se excluyen jib y prolongas manuales. El alcance horizontal no se presenta como longitud física de pluma.

- F660RA.2.25 a .28: transcripción visual de las cuatro imágenes existentes del proyecto, a 10°. [Fuente Fassi](https://www.fassi.com/wp-content/uploads/gru/3924/F660RA-he-dynamic-99-ce-kg-m.pdf).
- F545RA.2.22 a .25: diagramas DE 15848–15851, fila a 0°, página 8 del [catálogo Fassi](https://www.fassi.com/wp-content/uploads/gru/5530/F545RA-xe-dynamic-99-ce-kg-m.pdf), revisada visualmente.
- PK 32080 A/B: alcances de catálogo a 20° y capacidades contrastadas con los diagramas DT3140/04 que enlaza la [página oficial Palfinger](https://www.palfinger.com/apac/en/our-products/cranes/loader-cranes/models/pk-32080.html). Catálogo consultado: `https://www.palfinger.com/importdata/product-data/loader-cranes/brochures/pk-32080/pk-32080-brochure-en.pdf` (contenido indexado; descarga actual devuelve 404). No se añadieron C/D porque se encontraron diferencias entre documentos.

La confirmación de tabla exige comprobar que coinciden equipo, alcance, posición de pluma, estabilizadores, sector y accesorios. Para otra configuración se ingresan modelo, longitud, radio y capacidad bruta de su tabla manualmente. Cambiar modelo, alcance o capacidad invalida la confirmación anterior.

Referencias de uso: [OSHA, eslingas textiles](https://www.osha.gov/safe-sling-use/synth-web), [OSHA, procedimientos del fabricante y tablas de grúa](https://www.osha.gov/laws-regs/regulations/standardnumber/1926/1926.1417), [Crosby, reparto en conjuntos de cuatro ramales](https://www.thecrosbygroup.com/wp-content/uploads/catalog/2016/en-US/472.pdf). Son referencias técnicas; no se presenta OSHA como normativa local chilena.

## Verificación

Pruebas numéricas: `tests/liftAssessment.test.mjs`. Pruebas de interfaz y compilación en memoria: `tests/liftAssessment.ui.cjs`. Cubren límites independientes, ángulos, accesorios, confirmaciones invalidadas, puntos exactos, ambos temas, 375/812/1024 px y texto ampliado. Las pruebas no generan APK ni una vista previa HTML.
