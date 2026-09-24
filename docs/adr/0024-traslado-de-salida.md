# Traslado de salida entre operadores

Estado: aceptada. Decidida con el usuario al implementar HU-13 (issue #15). Resuelve una contradicción del diseño (qué hacer con `req_status 0`) y un hueco (qué se borra al confirmar). La rama `traslado-implementacion` del prototipo es referencia, no se fusiona.

**Decisión.** MS-07 orquesta el traslado como un proceso con estado en su base (RD-02), un paso por vez y todos idempotentes: (1) MS-04 congela la Carpeta (solo lectura), (2) MS-03 da de baja al ciudadano en GovCarpeta (`unregisterCitizen`, escritura), (3) MS-07 envía `transferCitizen` al destino con id, nombre, cuenta institucional y una URL prefirmada de solo lectura por documento, y (4) espera `transferCitizenConfirm`. La cuenta y los documentos se borran solo tras `req_status 1` verificado. Con `req_status 0`, MS-07 reafilia al ciudadano por MS-03, reabre la Carpeta y no borra nada.

**Impactos e implicaciones**

- Contradicción resuelta con el usuario: el diseño dice conservar la carpeta y escalar (el ciudadano queda sin operador en GovCarpeta, B-02); el prototipo reafilia de inmediato. Se reafilia. Si la reafiliación no se logra tras 5 intentos, el traslado queda en `atencion` (se escala) y la Carpeta sigue en solo lectura.
- Un `req_status 1` no basta por sí solo: la ruta de confirmación exige el enlace que MS-07 dio al destino (`{traslado}.{HMAC}`) y GovCarpeta debe mostrar al ciudadano en otro operador. Sin eso, 409 y no se borra nada. Solo el destino que recibió el enlace puede confirmar ese traslado.
- Cierre en dos pasos y en orden: MS-04 borra documentos y archivos, luego MS-03 borra la cuenta, y MS-07 deja el traslado `completo` y publica `ciudadano.trasladado` en la misma transacción (bandeja de salida, ADR-0018). Cada paso se reintenta sin tope hasta que los datos se borren.
- Borrado ampliado con el usuario: MS-05 y MS-09 consumen `ciudadano.trasladado` y borran su proyección y sus avisos (RD-11). MS-02 conserva la bitácora: es inalterable (RNF-14).
- RI-01 y RD-15: a GovCarpeta viajan datos de afiliación (id, nombre, correo institucional, operador); al destino, esos datos y URL prefirmadas, nunca credenciales del almacén ni contenido. El teléfono, el correo de contacto y la dirección no salen.
- RI-06: el binario va del almacén al destino por la URL prefirmada. Las URL duran 24 horas (`TRASLADO_URL_SEGUNDOS`), mucho más que las de descarga (60 s, ADR-0019), porque el destino puede tardar. Se piden frescas en cada intento y no se guardan.
- Escritura en GovCarpeta: `unregisterCitizen` y el re-registro son escrituras. La pasarela ya exige `GOVCARPETA_ESCRITURA=1` en el GovCarpeta real; sin él responde 503 y el traslado se revierte sin escribir. Compose usa el doble local.
- Destino sin `transferAPIURL` (B-16) o con dirección no permitida (no https pública, salvo hosts internos de compose): 422 y el traslado no empieza. El directorio marca esos operadores como no disponibles.
- MS-03 gana el estado `salida` y guarda la dirección al afiliar (para reafiliar). Los ciudadanos anteriores sin dirección se reafilian con «Sin dirección registrada».
- Infra de prueba nueva: `infra/operador-destino/`, un operador simulado con modos de prueba (rechazar, no aceptar, no confirmar, confirmar sin afiliar); el doble de GovCarpeta agrega `getOperators`.
- ponytail: `enviado` no tiene plazo: si el destino no confirma nunca, el traslado espera y la Carpeta sigue en solo lectura. Agregar un vencimiento con escalamiento si se necesita.
- ponytail: MS-06 (autorizaciones), MS-07 (envíos y traslados de entrada) y MS-11 (casos) conservan registros por cédula. Suscribirlos a `ciudadano.trasladado` cuando se defina su retención.
- ponytail: un grupo de consumidores nuevo (replay desde el inicio) puede reproyectar en MS-05 y MS-09 lo anterior al traslado; agregar una lápida con fecha si se reinicia el grupo.
- ponytail: el traslado no envía aviso por correo o SMS: el resultado lo ve el ciudadano en la SPA (`#traslado`). Suscribir MS-09 al resultado si se exige aviso proactivo.

**Problema.** HU-13 pide trasladar a un ciudadano sin perder documentos, con `transferCitizen` y `transferCitizenConfirm`, pero el diseño se contradice sobre el rechazo del destino y no dice qué más se borra.

**Contexto.** RF-01.7, RF-01.8, RF-03.1, RF-03.2, RF-03.5, RF-03.8, RI-01. Es la mitad de salida de HU-09, el traslado de entrada que ya recibe MS-07.

**Alcance.** MS-07, MS-03, MS-04, MS-05, MS-08 (pasarela), MS-09, `libs/eventos`, compose, la SPA y la infra simulada.

**Restricciones**

- RD-02: el estado del traslado está en la base de MS-07, no en el proceso.
- RD-11: cada servicio borra lo suyo; MS-07 no lee ni borra bases ajenas.
- RI-08 no interviene: el destino no es un tercero que lee con consentimiento sino un operador que recibe la Carpeta completa por decisión del titular.

**Supuestos**

- El contrato entre operadores es el del acuerdo de los equipos del curso: `transferCitizen { id, citizenName, citizenEmail, urlDocuments, confirmAPI }` y `transferCitizenConfirm { id, req_status }`. No hay contrato de MinTIC (B-01).
- `citizenEmail` es la cuenta institucional, que sobrevive al traslado (RF-01.5).

**Arquitectura de la solución.** Contratos: `interoperabilidad`, `afiliacion`, `custodia`, `pasarela` (OpenAPI) y `contratos/eventos/ciudadano-trasladado.v1.schema.json`. SPA: `#traslado`.

**Análisis comparativo**

| Criterio | Reafiliar y reabrir (elegida) | Solo escalar (diseño literal) |
|---|---|---|
| RI-03 Un operador a la vez | **Cumple.** El ciudadano nunca queda sin operador si MS-03 lo logra. | **No cumple.** Queda sin operador hasta que alguien lo resuelva a mano. |
| Fidelidad al diseño | **Parcial.** Cambia el escenario 6b del diseño (decidido con el usuario). | **Cumple.** |
| Coste | **Parcial.** Un paso más y el estado `atencion` para cuando falla. | **Cumple.** |

**Justificación.** Dejar a un ciudadano sin operador por un rechazo del destino contradice el propósito del traslado; el escalamiento queda como último recurso.

**Consenso.** El usuario eligió reafiliar y reabrir, y el borrado ampliado por evento a MS-05 y MS-09.

**Disenso.** Ninguno registrado.

**Decisiones relacionadas:** ADR-0009, ADR-0017, ADR-0018, ADR-0019
