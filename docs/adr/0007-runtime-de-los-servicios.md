# Runtime de los servicios

Estado: aceptada. Origen: AD-07 en `ArquitecturasAvanzadasDeSoftware/entregas-md/entrega2-carpeta-ciudadana.md` (*3.8).

**Decisión.** **Node.js 22 LTS con Express 5** en JavaScript ESM.

**Impactos e implicaciones**

- Imágenes pequeñas y arranque rápido.
- Sin tipos estáticos: la validación de entrada es explícita.

**Problema.** Elegir lenguaje y framework de los microservicios.

**Contexto.** Los servicios del prototipo son casi solo entrada y salida: base de datos, Keycloak, almacén y GovCarpeta.

**Alcance.** MS-03, MS-04 y MS-08.

**Restricciones**

- RD-02: procesos sin estado.
- RD-09: registros como flujo de eventos.

**Supuestos**

- El equipo domina JavaScript por los talleres del curso.

**Arquitectura de la solución.** Un servicio Express por microservicio, configuración por entorno, errores problem+json y pruebas con `node --test`.

**Análisis comparativo**

| Criterio | Node 22 + Express 5 (elegida) | Quarkus | Spring Boot | Go |
|---|---|---|---|---|
| RNF-04 Rendimiento | **Cumple.** E/S no bloqueante; aquí casi todo es E/S. | **Cumple.** Compilación nativa con arranque rápido. | **Parcial.** Arranque en frío lento en Cloud Run. | **Cumple.** Binario rápido. |
| Coste | **Cumple.** Lenguaje de los talleres: sin curva. | **Parcial.** Nuevo para el equipo. | **Parcial.** Conocido por parte del equipo. | **No cumple.** Nadie del equipo lo ha usado. |
| RNF-29 Desplegabilidad | **Cumple.** Imagen pequeña. | **Cumple.** Imagen nativa pequeña. | **Parcial.** Imagen pesada. | **Cumple.** Imagen mínima. |

**Justificación.** Node iguala en rendimiento a Quarkus y Go para cargas de E/S y es el único sin curva para el equipo en una semana de entrega.

**Consenso.** Acordado por el equipo.

**Disenso.** Quarkus aparece en el material del curso sobre microservicios nativos de Kubernetes. Queda como alternativa si un servicio pasa a ser intensivo en CPU.

**Decisiones relacionadas:** AD-03, AD-12
