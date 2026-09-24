# Envío a una entidad no afiliada por correo con enlaces resueltos por MS-07

Estado: aceptada. Decidida con el usuario al implementar HU-08 (issue #10). Concreta RF-04.1, RF-04.2, RF-03.4 y la nota B-14, y usa la decisión de autorizaciones del ADR-0020.

**Decisión.** El ciudadano arma un paquete y escribe el correo de la entidad con `POST /envios` a MS-07. Enviar es su decisión de compartir esos documentos con ese correo: MS-07 comprueba con MS-04 que son suyos, pide a MS-06 una autorización de 72 horas para `correo:{dirección}` y manda un correo con un enlace por documento, nunca el archivo. El enlace apunta a MS-07 (`/api/enlaces/{envío}/{documento}?f=…`); al abrirlo, MS-07 pide a la custodia una URL de lectura de 5 minutos, la custodia consulta a MS-06 y MS-07 redirige.

**Impactos e implicaciones**

- El enlace no guarda estado: `f` es un HMAC del envío y el documento con `ENLACE_SECRETO`, así que un reintento del correo reconstruye los mismos enlaces y solo sirven los emitidos. Cambiar el secreto invalida los enlaces vigentes.
- Cada apertura vuelve a pasar por MS-06 (RI-08) y deja un registro de acceso de un tercero. Revocar la autorización corta el enlace de inmediato; el enlace también vence con el envío a las 72 horas (410).
- Si el correo no sale, el envío queda `pendiente` (202) y un ciclo de reintentos lo retoma con retroceso de 10 s a 5 min, hasta 5 intentos y luego `fallido`. Reintentar no concede de nuevo, no crea otro envío ni manda un segundo correo. La cabecera `Idempotency-Key` hace seguro repetir la solicitud si la respuesta se pierde.
- Entrega al menos una vez: si el correo salió y el registro del estado falla, el reintento lo vuelve a enviar. «Entregado» significa que el servidor SMTP lo aceptó, no que el destinatario lo leyó.
- Al entregarse, MS-07 publica `envio.entregado` en la misma transacción que el estado (ADR-0018). MS-09 lo usa para confirmar la entrega al ciudadano por su canal, sin los enlaces, y MS-02 lo agrega a la bitácora con un registro por documento (`accion: envio`, `destino: correo:{dirección}`), que cumple «el envío queda en la bitácora de accesos».
- MS-07 gana su primera API para el ciudadano: valida el token con audiencia `interoperabilidad` (el emisor OIDC la agrega) y responde CORS a la SPA.
- Los plazos del SMTP son cortos (DNS, conexión y saludo de 5 s) para que un proveedor caído no cuelgue la solicitud.
- MS-04 gana `POST /interno/comprobacion` y MS-06 gana `POST /interno/autorizaciones`, ambas solo para la interoperabilidad.
- La SPA muestra los envíos y su estado, pero no ofrece revocar la autorización de un envío; la API de MS-06 ya lo permite y la pantalla se agrega cuando una historia lo pida.
- ponytail: sin límite de envíos por ciudadano ni por hora; agregarlo en el borde (Cloud Armor) en el objetivo.

**Problema.** El diseño de HU-08 dice «genera un enlace con vigencia de 72 horas» sin precisar qué es el enlace, cómo se relaciona con la autorización de MS-06 ni qué pasa si el correo falla; el ticket pide además confirmación de entrega y reintento idempotente.

**Contexto.** RI-08 exige que MS-06 decida antes de que MS-04 firme una URL de lectura; B-14 dice que el contenido nunca va adjunto; una URL prefirmada de 72 horas no se puede revocar y evita la decisión en cada acceso.

**Alcance.** MS-07, MS-04, MS-06, MS-09, MS-02, el emisor OIDC, compose y la SPA.

**Restricciones**

- RI-06: el binario viaja por URL prefirmada y no pasa por MS-07.
- RD-11: MS-07 guarda sus envíos en su propia base y no lee la de MS-04 ni la de MS-06.
- RD-02: el estado del envío y de los reintentos está en la base, no en el proceso.

**Supuestos**

- El destinatario no tiene cuenta: quien abre el enlace es quien tiene el correo, y el ciudadano acepta ese riesgo al enviarlo.
- Un correo SMTP en Mailpit alcanza para el prototipo; en el objetivo se usa un proveedor transaccional.

**Arquitectura de la solución.** Contrato: `/envios` y `/api/enlaces/{envioId}/{documentoId}` en `contratos/interoperabilidad.openapi.yaml`, `/interno/autorizaciones` en `contratos/autorizaciones.openapi.yaml` y `/interno/comprobacion` en `contratos/custodia.openapi.yaml`. Evento: `envio.entregado` (`contratos/eventos/`).

**Análisis comparativo**

| Criterio | Enlace propio que MS-07 resuelve (elegida) | URL prefirmada de 72 h en el correo |
|---|---|---|
| RI-08 Decisión antes de firmar | **Cumple.** MS-06 decide en cada apertura. | **Parcial.** Decide una sola vez, al enviar. |
| RF-04.5 Revocación | **Cumple.** Revocar corta el acceso al instante. | **No cumple.** La URL vive hasta vencer. |
| RNF-04 Simplicidad | **Parcial.** MS-07 gana un endpoint público y un HMAC. | **Cumple.** Una pieza menos. |
| RNF-11 Superficie de ataque | **Parcial.** El enlace es una credencial sin cuenta. | **Parcial.** Igual, y con más vida. |

**Justificación.** Cumplir RI-08 en cada acceso y poder retirar el consentimiento pesan más que el endpoint adicional.

**Consenso.** El usuario eligió el enlace propio resuelto por MS-07.

**Disenso.** Ninguno registrado.

**Decisiones relacionadas:** ADR-0017, ADR-0018, ADR-0019, ADR-0020
