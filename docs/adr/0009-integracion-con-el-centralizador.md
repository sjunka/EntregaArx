# Integración con el centralizador

Estado: aceptada. Origen: AD-09 en `ArquitecturasAvanzadasDeSoftware/entregas-md/entrega2-carpeta-ciudadana.md` (*3.8).

**Decisión.** Una **pasarela anticorrupción dedicada** (MS-08) con timeout de 8 s, reintento con backoff solo en operaciones idempotentes y circuit breaker.

**Impactos e implicaciones**

- Un salto de red más.
- El resto del sistema no conoce la prosa ni los códigos de GovCarpeta.

**Problema.** Decidir cómo hablan los servicios con GovCarpeta.

**Contexto.** El contrato devuelve prosa, se contradice en registerOperator y no tiene compromiso de disponibilidad (B-10). El centralizador debe recibir la mínima carga (RNF-20).

**Alcance.** MS-03, MS-04 y MS-08.

**Restricciones**

- RD-14: centralizador externo no modificable.
- RD-15: contrato GovCarpeta congelado.
- RI-01: sin contenido por el centralizador.

**Supuestos**

- GovCarpeta no exige autenticación (B-09).

**Arquitectura de la solución.** Tres operaciones propias que traducen a validateCitizen, registerCitizen y authenticateDocument. Rechaza cuerpos de más de 2 KB y URL que no sean https, para que ningún contenido pueda viajar.

**Análisis comparativo**

| Criterio | Pasarela dedicada (elegida) | Librería compartida | Llamada directa |
|---|---|---|---|
| RNF-07 Tolerancia a fallos | **Cumple.** Timeout, reintento y circuit breaker en un solo lugar. | **Parcial.** Cada servicio la configura. | **No cumple.** Sin protección. |
| RNF-20 Carga mínima del centralizador | **Cumple.** Un solo punto controla el ritmo hacia el centralizador. | **Parcial.** Reintentos sin coordinar entre servicios. | **No cumple.** Reintentos sin control. |
| RNF-26 Modificabilidad | **Cumple.** Si cambia el contrato cambia un servicio. | **Parcial.** Hay que redesplegar todos. | **No cumple.** El contrato se filtra a todo el código. |
| RNF-25 Observabilidad | **Cumple.** Todas las llamadas en un mismo registro. | **Parcial.** Registros repartidos. | **No cumple.** Sin punto de observación. |

**Justificación.** Es la aplicación directa del veredicto del SRS para RF-06: fuera del alcance, solo el adaptador. El salto extra cuesta milisegundos frente a los segundos que tarda GovCarpeta.

**Consenso.** Acordado por el equipo.

**Disenso.** Librería compartida para ahorrar un servicio; se rechazó porque no protege al centralizador de reintentos cruzados.

**Decisiones relacionadas:** AD-05, AD-10
