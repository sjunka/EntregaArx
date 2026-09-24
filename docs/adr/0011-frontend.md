# Frontend

Estado: aceptada. Origen: AD-11 en `ArquitecturasAvanzadasDeSoftware/entregas-md/entrega2-carpeta-ciudadana.md` (*3.8).

**Decisión.** **SPA React estática** publicada en GitHub Pages, sin renderizado en servidor.

**Impactos e implicaciones**

- La interfaz sigue en línea aunque caigan los servicios.
- El primer render depende de JavaScript.

**Problema.** Elegir cómo se construye y sirve el portal del ciudadano.

**Contexto.** RNF-16 y RNF-17 piden interfaz usable y accesible. El sitio de arquitectura ya es React en GitHub Pages.

**Alcance.** Portal Mi Carpeta Segura.

**Restricciones**

- docs/DESIGN.md manda en color, contraste e iconos.

**Supuestos**

- El portal no necesita SEO.

**Arquitectura de la solución.** React 18 con oidc-client-ts y vistas por hash, sin router; tokens verdes de DESIGN.md en claro y oscuro.

**Análisis comparativo**

| Criterio | SPA estática (elegida) | SSR con Next.js | App móvil nativa |
|---|---|---|---|
| Coste | **Cumple.** GitHub Pages sin servidor. | **Parcial.** Servidor Node que operar. | **No cumple.** Dos plataformas que mantener. |
| RNF-16 Usabilidad | **Cumple.** Flujos cortos de pocas pantallas. | **Cumple.** Mismo diseño posible. | **Parcial.** Hay que instalarla. |
| RNF-17 Accesibilidad | **Cumple.** axe en e2e y AA en los dos temas. | **Cumple.** Misma accesibilidad. | **Parcial.** Accesibilidad por plataforma. |
| RNF-01 Disponibilidad | **Cumple.** CDN independiente de los servicios. | **Parcial.** Si cae el servidor cae la interfaz. | **Cumple.** Funciona sin la web. |

**Justificación.** La SPA cumple los cuatro criterios sin servidor que operar.

**Consenso.** Acordado por el equipo.

**Disenso.** Ninguno registrado.

**Decisiones relacionadas:** AD-06
