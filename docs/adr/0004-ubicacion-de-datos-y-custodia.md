# Ubicación de datos y custodia

Estado: aceptada. Origen: AD-04 en `ArquitecturasAvanzadasDeSoftware/entregas-md/entrega2-carpeta-ciudadana.md` (*3.8).

**Decisión.** Contenido en **Cloud Storage**, metadatos transaccionales en **Cloud SQL PostgreSQL** y metadatos de consulta y auditoría en **MongoDB gestionado**. En el objetivo, los certificados van a un bucket dual-region con **Bucket Lock**; los temporales, a un bucket borrable.

**Impactos e implicaciones**

- Los certificados no se pueden borrar ni por un administrador.
- El derecho de supresión aplica solo a temporales (B-11).

**Problema.** Decidir dónde viven el contenido y los metadatos de los documentos.

**Contexto.** Los certificados se conservan a perpetuidad y sin alteración (RNF-02, RNF-03, RNF-13); los temporales tienen cuota y se pueden eliminar (RNF-24, RF-02.10).

**Alcance.** MS-04 y MS-02.

**Restricciones**

- RD-05: servicios de respaldo enchufables.
- RD-11: sin base de datos compartida.

**Supuestos**

- B-11 se resuelve separando certificados de temporales.

**Arquitectura de la solución.** Un objeto por documento, nombrado por identificador; metadatos, dueño, estado y SHA-256 en la base de custodia.

**Análisis comparativo**

| Criterio | Cloud Storage + Cloud SQL (elegida) | NAS + PostgreSQL on-premise | BLOB en la base de datos |
|---|---|---|---|
| RNF-02 Durabilidad | **Cumple.** Réplica dual-region. | **Parcial.** Depende de copias propias. | **Parcial.** Respaldos de base enormes. |
| RNF-03 Retención | **Cumple.** Bucket Lock con retención indefinida. | **Parcial.** WORM por software. | **No cumple.** Sin retención inalterable. |
| RNF-13 No repudio | **Cumple.** Objeto inmutable y hash guardado. | **Parcial.** Un administrador puede alterar. | **Parcial.** Un DBA puede alterar filas. |
| Coste | **Cumple.** Clases frías para documentos viejos. | **No cumple.** Hardware y operación. | **No cumple.** Almacenamiento de base más caro que objetos. |

**Justificación.** Separar contenido de metadatos deja cada dato en el motor hecho para él. Solo Cloud Storage ofrece retención inalterable gestionada.

**Consenso.** Acordado por el equipo.

**Disenso.** Ninguno registrado.

**Decisiones relacionadas:** AD-01, AD-08
