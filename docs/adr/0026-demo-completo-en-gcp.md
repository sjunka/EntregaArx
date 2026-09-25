# Demo completo en GCP: universidad simulada y buzón de prueba

Estado: aceptada (24 de septiembre de 2026, decidida con el responsable para la pre-entrega). Complementa ADR-0015 y ADR-0025.

El despliegue de la entrega 3 solo mostraba HU-01 a HU-04 en la nube. HU-05, HU-07 y HU-12 necesitan una entidad que emita certificados y pida documentos, y HU-05 y HU-08 necesitan un servidor de correo. Sin eso el equipo no podía hacer el demo completo en GCP.

**Decisión.** El despliegue de GCP suma dos piezas de prueba, las mismas que usa compose:

- `mcs-entidad`: la universidad simulada (`infra/entidad-simulada`) en Cloud Run. Su llave la genera Terraform (`tls_private_key`) y llega por Secret Manager, así un reinicio no deja a MS-07 con una llave pública vieja. MS-07 la registra en `EMISORES`. `/emitir` y `/peticiones` piden la cabecera `x-demo-clave` con la clave de las cuentas demo, para que nadie más firme como la universidad.
- Mailpit en la VM de Kafka. Los servicios le mandan correo por SMTP (1025) dentro de la subred; la página (8025) es pública con usuario `demo` y la clave de `terraform output -raw mailpit_clave`. Ningún correo sale a Internet. Si se define `smtp_url`, se usa ese servidor en lugar de Mailpit.

HU-09 y HU-13 (traslados) se siguen mostrando en compose: los operadores simulados tendrían que registrarse como operadores en el GovCarpeta real, y eso no está en el diseño.

## Arreglos que salieron del recorrido en la nube

- La pasarela no reconocía la respuesta de `validateCitizen` del GovCarpeta real, que llega entre comillas y con «operador:». Todo lo que verifica que el ciudadano es de este operador (recepción de certificados, peticiones) respondía 422.
- Keycloak solo ponía `empresa` y `analista` en el token de acceso; la SPA los lee del token de identidad. La empresa y el analista entraban como ciudadanos. El realm los incluye ahora en los dos.
- Kafka guardaba sus datos en `/tmp` del contenedor, no en el disco montado: un reinicio de la VM borraba los tópicos y con ellos los esquemas. `KAFKA_LOG_DIRS` apunta ahora al volumen.

## Consecuencias

- La página de Mailpit viaja por HTTP sin TLS, con la IP efímera de la VM. Sirve para un demo, no para correo real.
- Costo: la universidad escala a cero y Mailpit comparte la VM. No suma costo apreciable.
- El realm se importa solo cuando Keycloak arranca sin él. En el despliegue ya existente, los mapeadores se cambiaron por el Admin API.
