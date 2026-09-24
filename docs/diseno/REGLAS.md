# Reglas del entregable — Carpeta Ciudadana

Este archivo manda. Se lee **antes** de tocar `src/content/*.json`, el sitio o el documento generado.
Si una instrucción del usuario contradice una regla de aquí, gana el usuario y la regla se actualiza en el mismo turno.

---

## 1. Regla de estructura (la más importante)

**El esqueleto no se toca sin que el usuario lo pida explícitamente.**

Secciones fijas, en este orden y con esta numeración:

| # | Sección | Qué contiene |
|---|---|---|
| 1 | Introducción | Propósito, alcance, glosario, referencias y visión general |
| 2 | Descripción general | Perspectiva y diagrama de contexto, funciones, usuarios, restricciones generales, suposiciones y dependencias |
| 3 | Requerimientos específicos | Interfaces externas, funcionales por dominio, clases, no funcionales con QoS, inversos, restricciones de diseño, datos lógicos y granularidad |
| 4 | Modelos de análisis | Secuencia, transición de estados y flujo de datos |
| 5 | Proceso de gestión de cambios | Procedimiento, historial y aprobación |

La estructura es la del *Software Requirements Specification Template* del curso
(ANSI/IEEE Std. 830-1984). Se adoptó el 10 de septiembre de 2026 con permiso explícito del usuario,
sustituyendo al esqueleto de nueve secciones del borrador. En el cambio salieron cuatro bloques:
casos de uso, «el proyecto en palabras simples», la sección de evidencia de la API y las fichas de
bloqueos. Ninguno se perdió del todo: la evidencia de la API vive ahora en *3.1.3 y *3.1.4, y los
bloqueos abiertos se replantearon como *2.5 «Suposiciones y dependencias», que es su lugar en el
template. El *3.3 del template original —casos de uso— desaparece y las subsecciones posteriores
se renumeran de forma contigua: no se dejan huecos.

**Numeración de *3.2 y *3.4.** El template pide cinco sub-bloques por requerimiento funcional
(introducción, entradas, procesamiento, salidas y manejo de errores). Se escriben **una vez por
dominio**, no por requerimiento: con 65 requerimientos el desglose individual repetiría lo mismo
nueve veces sin añadir nada verificable. Los 30 requerimientos no funcionales se reparten en los
seis atributos del template más un séptimo, usabilidad y accesibilidad, porque el caso la declara
de máxima prioridad.

**Comportamiento fijo de las tablas.** La cabecera de cada tabla queda fija bajo la navegación
mientras se recorren sus filas, y se suelta al terminar esa tabla. Se consigue con `position:sticky`
en `thead th` anclado a `--navh`, que se mide en runtime. Para que funcione, `.tw` **no puede** crear
un contenedor de scroll: por encima de 1060 px lleva `overflow-x:visible`; por debajo vuelve a
`auto` para que las tablas anchas se puedan desplazar en horizontal. No revertir sin pedirlo.

Cambios permitidos sin preguntar: **contenido dentro de una sección** — añadir filas, corregir texto, mejorar un diagrama, reordenar filas de una tabla.

Cambios que requieren permiso: añadir o quitar una sección, renumerar, cambiar el orden, cambiar la paleta, cambiar la tipografía, cambiar el layout de la página.

---

## 2. Cómo se escribe un requerimiento

Formato copiado del material de referencia del curso. Es el que el profesor está leyendo, así que es el que usamos.

**Funcional** — cuatro columnas:

| ID | Requerimiento | Descripción | Prioridad |
|---|---|---|---|
| RF-01.1 | Registro de ciudadano | El operador debe permitir la inscripción de un ciudadano capturando sus datos básicos. | Alta |

**No funcional** — cuatro columnas:

| ID | Atributo de calidad | Requerimiento | Criterio de aceptación |
|---|---|---|---|

**Mapeo QoS** — cinco columnas:

| ID | Requerimiento No Funcional | Atributo de QoS | Métrica o indicador | Objetivo / umbral |
|---|---|---|---|---|

**Restricción de diseño** — cuatro columnas. La cuarta es lo que la hace defendible:
sin fuente citable no entra.

| ID | Restricción | Descripción | Origen |
|---|---|---|---|
| RD-02 | Procesos sin estado | El sistema debe ejecutarse como procesos sin estado, de modo que cualquier instancia pueda atender cualquier petición. | Twelve-Factor VI · Processes |

**Requerimiento inverso** — tres columnas. La descripción **siempre** dice qué *no* se hace.

| ID | Límite | El sistema no debe… |
|---|---|---|
| RI-01 | Sin contenido por el centralizador | El sistema no debe hacer pasar el contenido de ningún documento por el centralizador de MinTIC. |

**Granularidad** — cuatro columnas, una fila por dominio funcional, sin excepciones.

| Dominio | Driver dominante | Veredicto | Por qué |
|---|---|---|---|

La barrera de calidad de un requerimiento es la del *template* del curso (ANSI/IEEE Std. 830).
Antes de dar uno por bueno tiene que ser: **correcto, trazable** en los dos sentidos,
**inequívoco, verificable, priorizado, completo, consistente** e **identificable de forma única**.
De esas ocho, la que más se incumple es *verificable*: si nadie puede escribir la prueba que lo
declara cumplido, el requerimiento está mal redactado y se reescribe.

Reglas de redacción:

- **Una frase por requerimiento.** Si necesitas dos, son dos requerimientos.
- **Sujeto explícito y siempre el mismo**: «El sistema debe…», «El operador debe…», «El ciudadano debe poder…», «El centralizador debe…». Nunca «se debe» ni «hay que».
- **Verbo en presente, obligación con "debe".** Nada de «debería», «podría», «se recomienda».
- **La columna Requerimiento es un nombre corto**, dos a cuatro palabras, sin verbo: «Validación de afiliación única», «Carga inicial del documento de identidad».
- **La descripción no repite el nombre.** Explica el qué y el porqué, no el cómo.
- **Cero jerga sin traducir.** Si entra un término técnico, la primera vez lleva su explicación entre comas.
- **Los números van en el criterio de aceptación, no en la descripción.**
- **Prioridad: Alta / Media / Baja.** Alta = sin esto no hay MVP.

---

## 3. Numeración

- Funcionales jerárquicos por dominio: `RF-01.1`, `RF-01.2`, … donde `RF-01` es el dominio.
- No funcionales planos: `RNF-01`, `RNF-02`, …
- Restricciones de diseño: `RD-01`, …
- Requerimientos inversos: `RI-01`, …
- Casos de uso: `CU-01`, y cada uno cita los RF y RNF que realiza.
- Bloqueos: `B-01`, …
- **Los identificadores nunca se reciclan.** Si un requerimiento muere, su ID muere con él.

---

## 4. Cómo se marca lo que no está confirmado

Tres marcas, y solo tres:

| Marca | Significado |
|---|---|
| **Del PDF** | Sale literal del caso de estudio. |
| **Asunción** | Lo pusimos nosotros. Todo número inventado lleva esta marca. |
| **Bloqueo B-xx** | No se puede decidir; está escalado al profesor. |

Un requerimiento sin marca es un requerimiento confirmado. No se marca nada «por si acaso».

---

## 5. De dónde sale el vocabulario técnico

No inventamos categorías. Cuando hace falta nombrar un atributo, una restricción o un criterio
de tamaño, se usa el término del material del curso, tal cual el profesor lo dice.

**Restricciones de diseño.** Cada `RD` cita una de estas tres fuentes, y solo estas tres:

| Fuente | Cuándo se usa |
|---|---|
| `Twelve-Factor <N> · <Nombre>` | La restricción sale de uno de los doce factores. Se escribe el número romano y el nombre en inglés, como en la lámina. |
| `Cloud native · <Pilar>` | Sale de los siete pilares: Microservices, Containers, DevOps, API-first design, Immutable infrastructure, Auto-scaling, Observability. |
| `Caso de estudio` / `Evidencia de la API` | Sale del enunciado o de algo que verificamos nosotros. |

**Granularidad.** El veredicto de cada dominio se justifica con uno de los cinco desintegradores
de la clase, y con ninguno más: *alcance y función* (cohesión), *volatilidad del código*,
*escalabilidad y rendimiento*, *tolerancia a fallos*, *extensibilidad*.

Dos reglas heredadas del ejemplo del servicio de notificaciones:

- **Cohesión antes que tamaño.** Que un servicio haga tres cosas no lo condena: si las tres son
  el mismo propósito, se queda unido. Partir por partir es el error que la clase señala.
- **La prueba del nombre.** Si un servicio es difícil de nombrar porque hace cosas sin relación,
  se parte. Y al partir, se comprueba que lo que sobra tenga cohesión propia.

La sección 4 del entregable es **pre-análisis, no diseño**: dice qué tamaño deberían tener las
piezas y por qué, sin decidir todavía la descomposición. El *template* del curso avisa de que la
especificación de requerimientos no es el documento de diseño, y esa frontera se respeta.

**El validador es parte de la regla.** `scripts/check-content.mjs` comprueba que cada `RD` tenga
fuente, que cada `RI` diga qué *no* se debe hacer, y que el driver de granularidad esté en el
conjunto cerrado de arriba. Si una regla de aquí cambia, el validador cambia en el mismo commit.

---

## 6. Cómo se hace un diagrama

**Modelo de referencia: el *system context artifact* de la lámina del profesor (IBM).** Se copia su gramática:

- El sistema en construcción es **un círculo** en el centro.
- **Personas a la izquierda**, separadas por una línea roja punteada vertical rotulada **«Línea de automatización»**.
- **Sistemas TI a la derecha**, separados por una línea punteada vertical rotulada **«Integración con…»**.
- Las flechas se rotulan con **los datos que viajan**, en lista apilada de sustantivos: «Detalles del pedido / Datos de pago». Nunca con verbos.
- Una flecha por sentido. Nada de flechas de doble punta.

Reglas técnicas, heredadas del skill `diagram-design`:

- Conectores en ángulo recto redondeado. Diagonales, no.
- Toda etiqueta lleva máscara opaca detrás y **6–10 px de aire** respecto a su línea.
- Máximo **9 nodos y 12 flechas** por diagrama. Si te pasas, son dos diagramas.
  - *Excepción:* en un diagrama de secuencia se cuentan las **líneas de vida** (máximo 5) y los **mensajes** (máximo 12), no los nodos. En un diagrama de estados se cuentan los estados.
- Acento de color en **1 o 2 elementos**, nunca más.
- Coordenadas y tamaños múltiplos de 4.
- Leyenda en tira horizontal abajo, nunca flotando dentro del dibujo.
- Verificar con `self_check.py` y `verify-geometry.py` antes de publicar.

---

## 7. Cómo se explica algo

Para las secciones de prosa (4, 6 y los pies de diagrama):

- **Frases cortas.** Si una frase pasa de dos líneas, se parte.
- **Primero la idea, después el detalle.** El primer párrafo tiene que servir solo.
- **Se explica con el ejemplo del caso**, no en abstracto: Andrés, el MEN, la embajada.
- **Analogía antes que definición** cuando el concepto es nuevo.
- Se mantiene el término técnico exacto, pero **se traduce la primera vez**.
- **Nada de relleno**: sin «cabe destacar», «es importante mencionar», «en el mundo actual».
- **Sin listas de tres por costumbre.** Si hay dos cosas, van dos.
- Pie de diagrama: **lo más corto posible**. El diagrama ya explicó; el texto solo cierra.

---

## 7 bis. El signo de sección no se escribe

Nunca se escribe el signo de sección (U+00A7, *section sign*). No en el documento, no en el
sitio, no en los scripts, no en los comentarios, no en la terminal. Las referencias cruzadas
llevan asterisco: `*3.2`, `*1.4`. Al documentar esta regla el símbolo se nombra, no se imprime.

## 8. Qué no se hace nunca

- Inventar un número sin marcarlo como asunción.
- Copiar texto del documento de un compañero. Se toma la idea y se reescribe con estas reglas.
- Añadir un requerimiento que el caso no sostiene, para rellenar.
- Tocar la paleta, la tipografía o el layout del artefacto.
- Publicar un diagrama sin pasar las dos verificaciones.
- **Editar a mano `docs/srs-assignment1.md`, `assignment1/srs-assignment1.md`, los tres HTML de
  `assignment1/diagramas/` que genera `build-diagrams.mjs` o los cuatro PNG que genera
  `build-png.mjs`.** Todos son salida de `npm run md`,
  igual que `dist/`. Se cambia el JSON y se vuelven a generar; así el
  sitio y el documento no pueden desincronizarse.
  **Excepción: `docs/agents/`.** Ese directorio no es salida de `npm run md`: lo escribe
  `/setup-matt-pocock-skills` y lo leen los skills de ingeniería para saber dónde viven los
  issues y la documentación de dominio. Se edita a mano y no se regenera. `CONTEXT.md` y
  `docs/adr/`, cuando existan, siguen la misma excepción.
- Añadir una restricción de diseño sin citar su factor, su pilar o el caso.
- Partir un servicio en el análisis de granularidad sin nombrar el driver que lo justifica.

---

## 9. Sistema de diseño — Notion

Los tokens viven en `src/styles/tokens.css`. `docs/DESIGN.md` es el sistema de diseño del
**producto** Carpeta Ciudadana: manda en color, contraste, iconografía y tema, y de ahí salen
las reglas transversales que este documento también cumple.
**En las hojas de estilo no se escribe ningún hex.** Todo sale de un token.

Las siete reglas que no se rompen:

1. **Un solo acento estructural: el azul `--primary`.** Pinta acciones, enlaces, el indicador
   de sección activa y el foco. Nada más lo usa.
2. **La paleta de stickers solo decora y marca estado.** Nunca pinta una acción ni una
   estructura. Aquí se usa para: `--st-caso` verde (confirmado), `--st-asuncion` naranja
   (lo inventamos), `--st-bloqueo` morado (escalado al profesor).
3. **La jerarquía la lleva el peso, no el color.** La prioridad Alta es una píldora de tinta
   sólida, Media es contorno, Baja es tinta tenue. Tres colores para tres niveles sería ruido.
4. **La página vive en papel cálido `--canvas-soft`; las tarjetas son blancas `--surface`.**
   Ese contraste crea figura y fondo sin necesidad de sombras.
5. **La elevación es filete más `--e-1`.** Nunca una sombra dura. El único momento invertido
   de la página es la portada, con la banda noche `--secondary`. No se repite en ninguna otra.
6. **Los dos temas cumplen AA, y lo comprueba `npm run check`.** Un token de relleno no vale
   como color de texto sobre ese mismo relleno al invertir el tema: para eso están
   `--primary-text`, `--on-accent` y `--ink-faint-text`. `--ink-faint` solo pinta líneas.
7. **Los iconos son Lucide, nunca emojis.** 20px y trazo 1.75 en controles, `aria-hidden`
   cuando van con texto. Un estado nunca se comunica solo con color ni solo con un icono.

Radios: campos 4px, botones utilitarios 8px, tarjetas 12px, contenedores grandes 16px,
píldoras y avatares `--r-full`. Los campos de formulario nunca llevan radio de píldora.

Tipografía: **Inter** en todo, sustituyendo a NotionInter. Los titulares van en 700 con
tracking negativo explícito, que se hace más negativo cuanto mayor es el tamaño. El cuerpo
se queda en 400. **IBM Plex Mono** solo para identificadores, rutas y código.

En los diagramas: el sistema en construcción va en `--ink-secondary` con texto claro; el flujo
crítico usa `--primary`; la línea de automatización usa `--accent-orange` porque marca una
frontera, no una acción.

---

# Parte A2 — Arquitectura (Assignment 2)

Todo lo anterior es la parte A1 y no cambia. Lo que sigue aplica solo a `src/arquitectura/`,
`operador/` y `scripts/arquitectura/`. El validador es `scripts/arquitectura/check.mjs`.

## A2.1 Esqueleto fijo

01 Introducción y trazabilidad · 02 Historias de usuario · 03 Microservicios y componentes ·
04 Secuencias · 05 Despliegue · 06 Decisiones de arquitectura · 07 Implementación.

## A2.2 Identificadores

`HU-NN`, `MS-NN`, `AD-NN`. Nunca se reciclan. Todo `RF`, `RNF`, `RD`, `RI` o `B` citado debe existir en A1.

## A2.3 Historias de usuario

- «Como <rol> quiero <acción> para <beneficio>».
- Criterios de aceptación verificables.
- Escenario principal numerado que alterna actor y sistema.
- Al menos un escenario alterno.
- Campo `realiza` con RF/RNF y estado `Implementada` o `Diseñada`.
- Cada dominio RF-01..RF-09, salvo RF-06, queda cubierto por al menos una HU.

## A2.4 Microservicios

Responsabilidad en una frase; dominio A1 y veredicto de granularidad (*4.3 de A1) respetados:
Partir en dos = 2 MS; Aislar o Mantener unido = 1 MS; Fuera del alcance = solo la pasarela ACL.
Cada MS declara las historias que realiza, la interfaz que ofrece, las interfaces que requiere,
eventos, datos propios y estado. Ofrecer y requerir son las dos mitades de la notación de
componente de UML, y toda HU la realiza al menos un MS.

## A2.5 Decisiones de arquitectura (plantilla UAM)

Decisión; impactos e implicaciones; problema, contexto, alcance, restricciones y supuestos;
arquitectura de la solución; análisis comparativo (al menos 2 alternativas por criterio, con
Cumple / Parcial / No cumple y motivo, sin puntajes inventados); justificación; consenso y disenso;
decisiones relacionadas. Criterios solo del conjunto cerrado: atributos RNF de A1, coste y regulación.

## A2.6 Diagramas desde JSON

- Componentes: máximo 9 nodos y 12 flechas. Un componente propio lleva el icono UML —el rectángulo
  con las dos pestañas—; un paquete (`"paquetes": true`) lo sustituye por la pestaña superior
  izquierda y lista en su subtítulo los módulos que reúne.
- Secuencias: máximo 5 líneas de vida, 12 mensajes y 1 fragmento. Cada mensaje en dos líneas:
  datos que viajan (sustantivos) y operación del contrato en mono.
- Despliegue: máximo 3 zonas, 6 nodos, 9 artefactos y 8 rutas.
- Coordenadas múltiplos de 4, segmentos ortogonales, acento en 2 elementos como mucho.

## A2.7 Verificación de diagramas

`scripts/arquitectura/check.mjs` (presupuestos, ortogonalidad, múltiplos de 4, referencias) y
`self_check.py` de diagram-design sobre el HTML exportado. Sustituye a `verify-geometry.py`, que no existe.

## A2.8 Salidas A2 que no se editan a mano

`docs/arquitectura-assignment2.md`, `../assignment2/*.md`, `../assignment2/diagramas/*`,
`public/arquitectura/*.pdf`, videos y mapa archify.

## A2.9 Producto SPA

`docs/DESIGN.md` manda (verde institucional). Tokens en `operador/web/src/tokens.css`. AA en los dos temas.
