# Persistencia

Estado: aceptada. Origen: AD-08 en `ArquitecturasAvanzadasDeSoftware/entregas-md/entrega2-carpeta-ciudadana.md` (*3.8).

**Decisión.** **PostgreSQL 16** para lo transaccional y **MongoDB** para metadatos de consulta, auditoría y analítica, con una base por servicio, y almacén de objetos por **API S3**: MinIO en local y Cloud Storage con claves HMAC en nube.

**Impactos e implicaciones**

- Un solo código S3 para local y nube.
- Cada servicio migra su esquema por separado.

**Problema.** Elegir motor de datos y cómo se reparte entre servicios.

**Contexto.** Cuota y estados de documentos necesitan transacciones. El índice de carpeta, la auditoría, las preferencias y la analítica son documentos de metadatos que se leen mucho más de lo que se escriben y cuyo esquema va a crecer. Cloud Storage acepta URL prefirmadas AWS V4 con HMAC.

**Alcance.** Los once microservicios y Keycloak. En el prototipo, MS-03, MS-04 y Keycloak, que solo usan PostgreSQL.

**Restricciones**

- RD-11: sin base de datos compartida.
- RD-10: migraciones como proceso aparte.

**Supuestos**

- Una instancia Cloud SQL con tres bases basta para el prototipo.
- MongoDB entra con los servicios diseñados (MS-02, MS-05, MS-09 y MS-10); el prototipo no lo necesita.

**Arquitectura de la solución.** Bases PostgreSQL `afiliacion`, `custodia` y `keycloak` con usuarios distintos; bases MongoDB por servicio para auditoría, índice de carpeta, notificaciones y analítica; bucket privado con CORS para el portal.

**Análisis comparativo**

| Criterio | PostgreSQL + MongoDB por servicio + S3 (elegida) | Solo PostgreSQL | Solo MongoDB |
|---|---|---|---|
| RNF-06 Consistencia | **Cumple.** Transacciones para cuota y estados. | **Cumple.** Transacciones en todo. | **Parcial.** Transacciones multi-documento con costo. |
| RNF-26 Modificabilidad | **Cumple.** Migraciones por servicio y esquema flexible donde el dato crece. | **Parcial.** Cada cambio de metadatos exige migración. | **Cumple.** Esquema flexible. |
| RNF-27 Libertad tecnológica | **Cumple.** Ambos motores y la API S3 corren en cualquier nube. | **Cumple.** Corre en cualquier nube. | **Cumple.** Corre en cualquier nube. |
| Coste | **Parcial.** Dos motores gestionados con costo base. | **Cumple.** Un solo motor que operar. | **Cumple.** Un solo motor que operar. |

**Justificación.** Un solo motor obliga a renunciar a las transacciones o a la flexibilidad. PostgreSQL da transacciones y aislamiento por base donde la consistencia manda; MongoDB absorbe los metadatos que crecen sin migraciones; la API S3 evita escribir dos adaptadores de almacén.

**Consenso.** Acordado por el equipo.

**Disenso.** Solo PostgreSQL reduce la operación a un motor; se rechazó porque los metadatos de consulta y la analítica cambian de forma sin pasar por migraciones.

**Decisiones relacionadas:** AD-04, AD-05
