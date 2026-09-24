# Peticiones de entidades, autorizaciones y lectura de terceros

Estado: aceptada. Decidida con el usuario al implementar HU-07 (issue #9). Concreta AD-05 y RI-08; cierra huecos que el diseño de HU-07 deja abiertos.

**Decisión.** Una entidad pide documentos con `POST /api/peticiones` a MS-07, firmado como las emisiones de ADR-0017; MS-07 la registra en MS-06 y el ciudadano la ve en la SPA. El ciudadano autoriza documento por documento o rechaza la petición completa. La entidad recoge lo autorizado con `GET /api/peticiones/{id}`, autenticada con un JWS de vida corta. Cada lectura pasa por la custodia, que pregunta a MS-06 antes de firmar una URL de 5 minutos. La autorización dura 72 horas (`AUTORIZACION_HORAS`) y se puede revocar.

**Impactos e implicaciones**

- MS-06 (`servicios/autorizaciones/`, base propia `autorizaciones` en Postgres) guarda peticiones y autorizaciones, nunca documentos ni títulos (RD-11). Sus interfaces: rutas del ciudadano, `/interno/peticiones` (interoperabilidad) y `/interno/decisiones` (custodia).
- MS-04 gana `POST /interno/lecturas` para la interoperabilidad: busca el documento, pregunta a MS-06 con el titular real y solo entonces firma. Si MS-06 no responde, no firma (falla cerrada, 503). Cada lectura publica `acceso.registrado` con actor tercero, que MS-02 ya audita (ADR-0019).
- Un tercero se identifica con una cadena: `entidad:{id}` para una entidad con llave registrada y `correo:{dirección}` para el envío de HU-08.
- Revocar impide nuevas lecturas de inmediato porque la custodia pregunta en cada una. Una URL ya entregada sigue viva hasta que vence, 5 minutos como máximo.
- La entidad se autentica con la llave pública de su directorio (`EMISORES`): la petición lleva un JWS con `idExterno`, `cedula`, `proposito` y los títulos pedidos; la consulta lleva un JWS `{ iss, iat, exp }` de máximo 5 minutos.
- El ciudadano no puede autorizar más documentos de los que la entidad pidió. La SPA no marca nada de antemano.
- Rechazar deja a la entidad solo con `estado: rechazada`, sin ningún dato de la carpeta.
- Los clientes de servicio del emisor OIDC pasan a tener lista de audiencias: `interoperabilidad` a `custodia` y `autorizaciones`, y `custodia` (nuevo, `KC_CUSTODIA_SECRETO`) a `autorizaciones`. El token del ciudadano suma la audiencia `autorizaciones`.
- El diseño dice que MS-06 emite `autorización concedida` y `revocada`. Ningún consumidor los necesita todavía (MS-02 audita los accesos, no las decisiones), así que no se publican; se agregan cuando una historia los pida.
- ponytail: el proveedor de token de servicio está copiado en la custodia y la interoperabilidad; extraer a un paquete si un tercer servicio lo necesita.

**Problema.** El diseño de HU-07 muestra la petición al ciudadano y entrega el documento autorizado, pero no dice cómo una entidad crea la petición, cómo se autentica, cuánto dura la autorización ni por dónde recoge el documento.

**Contexto.** RF-04.3 a RF-04.5 piden petición, decisión por documento, vigencia y revocación; RI-08 exige que MS-06 decida antes de que MS-04 firme una URL de lectura; ADR-0017 ya dio a MS-07 un mecanismo de autenticación de entidades por JWS.

**Alcance.** MS-06, MS-07, MS-04, el emisor OIDC, `infra/entidad-simulada/`, compose y la SPA.

**Restricciones**

- RI-08: MS-06 decide antes de que MS-04 firme.
- RI-06 y RI-01: el binario viaja por URL prefirmada y no pasa por MS-07 ni por GovCarpeta.
- RD-11: MS-06 no lee la base de MS-04 ni al revés.

**Supuestos**

- Las entidades que piden documentos están en el directorio `EMISORES`; no hay una consola de entidades todavía.
- Las autorizaciones se consultan por documento y tercero exactos; no hay comodines.

**Arquitectura de la solución.** Contratos: `contratos/autorizaciones.openapi.yaml`, `/api/peticiones` en `contratos/interoperabilidad.openapi.yaml` y `/interno/lecturas` en `contratos/custodia.openapi.yaml`. Puerto local de MS-06: 8093.

**Análisis comparativo**

| Criterio | Petición por MS-07 con JWS de entidad (elegida) | Petición directa a MS-06 con token de servicio |
|---|---|---|
| RNF-13 No repudio | **Cumple.** La petición queda firmada con la llave de la entidad. | **No cumple.** Un secreto compartido no prueba quién pidió. |
| RNF-19 Interoperabilidad | **Cumple.** Reusa el estándar de ADR-0017. | **Parcial.** Cada entidad necesita un cliente OIDC. |
| Seguridad (RI-08) | **Cumple.** MS-06 no se expone a terceros. | **No cumple.** MS-06 quedaría publicado. |
| Coste | **Parcial.** MS-07 gana dos rutas. | **Cumple.** Una pieza menos. |

**Justificación.** MS-07 ya es la puerta de las entidades y ya sabe verificar sus firmas; dejar MS-06 detrás de él mantiene la decisión de consentimiento fuera del alcance de terceros.

**Consenso.** El usuario eligió petición por MS-07 con JWS de entidad y vigencia de 72 horas.

**Disenso.** Ninguno registrado.

**Decisiones relacionadas:** ADR-0006, ADR-0017, ADR-0018, ADR-0019
