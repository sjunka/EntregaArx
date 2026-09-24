# Recepción de Certificados de las entidades

Estado: aceptada. Decidida con el usuario al implementar HU-05 (issue #7). Ocupa el hueco que deja B-01 (sin contrato MinTIC).

**Decisión.** Una entidad entrega un Certificado en dos pasos contra MS-07. Paso 1: `POST /api/documentos` con los metadatos y un JWS compacto (RS256 o ES256) cuyo payload repite `idExterno`, `cedula`, `titulo` y `sha256` y cuyo `iss` es la entidad; MS-07 lo verifica con la llave pública que tiene registrada para ella. Paso 2: la entidad sube el archivo a la URL prefirmada de 5 minutos y llama a `POST /api/documentos/{id}/confirmacion`. La custodia compara tamaño, tipo y SHA-256 con lo firmado.

**Impactos e implicaciones**

- Firma inválida: el Certificado queda Rechazado en MS-04, no entra a la Carpeta y la entidad recibe el motivo con 422. Un emisor sin llave registrada recibe 403 y no se guarda nada.
- El envío es idempotente por (emisor, `idExterno`), con un índice único en MS-04. La bandeja de salida de MS-07 deduplica el evento por documento.
- Un Certificado no consume cuota y no se puede eliminar (`DELETE` responde 409). Va a un bucket propio, `mcs-certificados`; en el objetivo, con retención bloqueada (ADR-0004).
- Un Temporal es equivalente a un Certificado si es del mismo titular y tiene el mismo título normalizado (sin tildes, mayúsculas ni espacios de más). El Temporal Cargado más antiguo que coincida pasa a Sustituido y queda enlazado al Certificado, en la misma sentencia que lo deja Vigente.
- MS-07 llama a MS-04 con un token de servicio (client credentials, cliente `interoperabilidad`, ADR-0006). Las rutas `/interno/*` de MS-04 rechazan tokens de ciudadano.
- Recibido y Verificado son estados persistidos; Vigente, Rechazado y Retirado completan el ciclo del glosario.

**Problema.** El diseño describe la HU pero no fija la firma, el flujo del binario ni qué hace equivalente a un Temporal.

**Contexto.** RF-03.3 exige validar firma y metadatos antes de aceptar; B-03 ya supone una PKI simulada con JWS sobre SHA-256; RI-06 y RI-01 prohíben que el contenido pase por MS-07 o por GovCarpeta.

**Alcance.** MS-07, MS-04, el emisor OIDC (cliente de servicio) y `infra/entidad-simulada/`.

**Restricciones**

- RI-06: el binario viaja por URL prefirmada.
- RD-11: MS-07 tiene su propia base (la bandeja de salida) y no lee la de MS-04.

**Supuestos**

- No hay una entidad real: compose trae `universidad-demo`, que genera sus llaves al arrancar y publica su JWKS. El directorio de emisores es la variable `EMISORES`.
- ponytail: sin límite de tasa por entidad; agregarlo en el borde (Cloud Armor) en el objetivo.

**Arquitectura de la solución.** Contrato: `contratos/interoperabilidad.openapi.yaml` y las rutas internas de `contratos/custodia.openapi.yaml`. Evento: `documento.recibido` cuando queda Vigente (ADR-0018).

**Análisis comparativo**

| Criterio | JWS con llave pública registrada (elegida) | HMAC con secreto por entidad | Firma simulada |
|---|---|---|---|
| RNF-13 No repudio | **Cumple.** Solo la entidad tiene la llave privada. | **No cumple.** El operador también conoce el secreto. | **No cumple.** No prueba nada. |
| RNF-19 Interoperabilidad | **Cumple.** Estándar abierto, JWKS. | **Parcial.** Hay que compartir secretos. | **No cumple.** |
| Coste | **Parcial.** Hay que registrar la llave de cada entidad. | **Cumple.** | **Cumple.** |

**Justificación.** Es lo que B-03 ya proponía y da no repudio sin distribuir secretos.

**Consenso.** Elegida por el usuario. La equivalencia por título normalizado también.

**Disenso.** Ninguno registrado.

**Decisiones relacionadas:** ADR-0004, ADR-0006, ADR-0018
