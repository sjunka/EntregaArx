# Preferencias de canal en MS-09

Estado: aceptada. Decidida con el usuario al implementar HU-05 (issue #7). Complementa AD-05 y AD-08.

**Decisión.** MS-09 (Notificaciones) expone una API mínima, `GET` y `PUT /preferencias` y `GET /notificaciones`, para que el ciudadano elija por qué canal le avisan (correo, SMS o ambos) y vea sus avisos. Los datos de contacto le llegan por el evento `ciudadano.afiliado` que MS-03 publica al afiliar, no por la SPA.

**Impactos e implicaciones**

- Es una excepción a «MS-09 sin API síncrona» de la tabla de interfaces de la entrega 2 (*3.3.1): MS-09 valida el token del ciudadano con audiencia `notificaciones`.
- El emisor OIDC agrega esa audiencia al token de acceso (`aud: [custodia, notificaciones]`), como lo haría un mapeador de audiencia en Keycloak.
- MS-03 gana una bandeja de salida y publica un evento con correo y celular. Esos datos viajan solo por el bus interno, nunca a GovCarpeta (RD-15, RNF-21).
- MongoDB entra por primera vez, solo para MS-09 (ADR-0008).

**Problema.** El ticket exige que el ciudadano elija canal, y el diseño no da a MS-09 un punto de entrada ni dice de dónde salen los contactos.

**Contexto.** RF-05.4 (preferencias de canal) es de prioridad Baja y el diseño la ubica en MS-09, que guarda «preferencias» en MongoDB. Los contactos ya existen en MS-03 y en la cuenta institucional, pero MS-09 no llama a ningún servicio.

**Alcance.** MS-09, MS-03, el emisor OIDC y la SPA.

**Restricciones**

- RD-11: MS-09 no lee la base de MS-03 ni el Admin API de identidad.
- RD-15 y RNF-21: el contacto no viaja a GovCarpeta.

**Supuestos**

- Quien se afilió antes de HU-05 no tiene contacto en MS-09: su primer aviso queda como fallido y con alerta operativa hasta que se afilie o se cargue su contacto.

**Arquitectura de la solución.** `ciudadano.afiliado` (CloudEvents, esquema en `contratos/eventos/`) alimenta la colección `contactos` con el correo como canal por defecto; `PUT /preferencias` cambia solo los canales. Las respuestas enmascaran el destino (`an***@correo.co`, `300***4567`). Contrato: `contratos/notificaciones.openapi.yaml`.

**Análisis comparativo**

| Criterio | API mínima y contacto por evento (elegida) | Canal dentro del evento, sin API | API y contacto tomado del token |
|---|---|---|---|
| RNF-26 Modificabilidad | **Cumple.** El ciudadano cambia de canal sin tocar MS-03. | **No cumple.** Cambiar de canal exige un evento nuevo desde el registro. | **Cumple.** Sin evento de contacto. |
| RNF-21 Minimización de datos | **Cumple.** El contacto queda en MS-09 y no sale del bus interno. | **Cumple.** Igual. | **Parcial.** El token no lleva el celular y el correo institucional no es el de contacto. |
| Fidelidad al diseño | **Parcial.** Agrega una API; conserva el consumo de `ciudadano.afiliado`. | **Cumple.** MS-09 sin API. | **No cumple.** MS-09 no consumiría `ciudadano.afiliado`. |
| Coste | **Parcial.** Una bandeja más en MS-03. | **Parcial.** Igual. | **Cumple.** Una pieza menos. |

**Justificación.** El ciudadano debe poder cambiar de canal después del registro (RF-05.4), y eso exige un punto de entrada. Mantener el evento conserva la regla de que MS-09 no llama a otros servicios.

**Consenso.** Elegida por el usuario entre las tres opciones.

**Disenso.** Ninguno registrado.

**Decisiones relacionadas:** AD-05 (0005), AD-08 (0008), AD-10 (0010)
