# Traslados con el formato del curso para operar con otros equipos

Estado: aceptada (24 de septiembre de 2026, decidida con el responsable). Cambia HU-09 y ajusta HU-13. Reemplaza la firma de operador de B-16 para traslados.

HU-09 solo aceptaba traslados de nuestros operadores simulados: además del formato del diseño (id, nombre, correo, URL de los documentos y `confirmAPI`), exigía dirección, teléfono, SHA-256 y tamaño de cada documento y una firma JWS con una llave registrada aquí. Ningún operador de otro equipo manda eso, así que HU-09 y HU-13 no se podían mostrar en la nube.

**Decisión.**

- `POST /api/transferCitizen` recibe el formato del curso, el mismo que ya envía nuestro HU-13: `{ id, citizenName, citizenEmail, urlDocuments: { título: [url, …] }, confirmAPI }`.
- La confianza no viene de una firma sino de GovCarpeta (RI-03): el traslado se acepta solo si GovCarpeta muestra al ciudadano sin operador, porque el origen ya lo dio de baja. `confirmAPI` y las URL deben ser https públicas.
- El operador de origen se identifica por el host de `confirmAPI`.
- La custodia calcula tamaño, tipo y SHA-256 del archivo descargado. Solo acepta PDF, JPG o PNG de hasta 10 MB.
- La cuenta institucional es `citizenEmail`. El enlace de activación se envía por correo a esa dirección. Al activar, el ciudadano elige su clave y da su dirección y celular, que el formato no trae. La afiliación en GovCarpeta espera a esa activación; si el enlace vence (24 h), el traslado falla y el origen recibe `req_status 0`.
- Nuestra dirección de traslado se publica en GovCarpeta con `registerTransferEndPoint` (permiso explícito del responsable). La confirmación se acepta en `confirmAPI` (con token) y también en `endPointConfirm` sin token, buscando el traslado por cédula.

## Consecuencias

- Cualquier operador puede iniciar un traslado de un ciudadano que GovCarpeta muestra libre. No se afilia a nadie sin que el ciudadano active su cuenta.
- En GCP el correo sale a Mailpit: un ciudadano de otro equipo solo recibe el enlace si hay un SMTP real (`smtp_url`).
- Los operadores simulados de compose usan el mismo formato; desaparece su firma.
