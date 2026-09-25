# Mi Carpeta Segura

Operador de Carpeta Ciudadana (curso Arquitecturas Avanzadas de Software). Glosario en `CONTEXT.md`, decisiones en `docs/adr/`.

## Arranque local

Requiere Docker Desktop y Node 22. La primera vez tarda porque construye las imágenes.

```sh
npm run local           # crea .env con claves aleatorias si falta, levanta todo y espera a que esté sano
npm run local:parar     # detiene los contenedores
npm run local:limpiar   # borra contenedores y volúmenes (se pierden los datos)
npm run local:e2e       # pruebas e2e contra el stack local
```

Al terminar, `npm run local` imprime la URL de la app, la de Mailpit y la cuenta demo con su clave. Equivale a `cp .env.example .env` más `docker compose up -d --build --wait`.

El demo completo en local sigue los mismos pasos que en GCP, con las 13 historias (incluido HU-13 contra el Operador Destino simulado). La guía está en https://claude.ai/artifact/KvS5LjWqGThgVKjwRgGjh3#local (pestaña Demo, botón **En local**). Cambian las URL: universidad simulada en `http://localhost:8088` (sin `x-demo-clave`) y traslado de entrada con `curl -X POST localhost:8094/trasladar -H 'content-type: application/json' -d '{"cedula":"<nueva>"}'`.

| Servicio | URL |
|---|---|
| SPA | http://localhost:4173 |
| Emisor OIDC simulado | http://localhost:8081/realms/carpeta |
| Afiliación (MS-03) | http://localhost:8082 |
| Custodia (MS-04) | http://localhost:8083 |
| Interoperabilidad (MS-07) | http://localhost:8086 |
| Notificaciones (MS-09) | http://localhost:8087 |
| Índice de carpeta (MS-05) | http://localhost:8091 |
| Auditoría (MS-02) | http://localhost:8092 |
| Autorizaciones (MS-06) | http://localhost:8093 |
| Premium (MS-11) | http://localhost:8095 |
| Analítica (MS-10) | http://localhost:8096 |
| Entidad emisora simulada | http://localhost:8088 |
| MinIO (almacén S3) | http://localhost:9000 (consola 9001) |
| Schema Registry | http://localhost:8085 |
| Mailpit (correos de prueba) | http://localhost:8025 |
| Pasarela de GovCarpeta (MS-08) | http://localhost:8084 |
| GovCarpeta simulado | http://localhost:8090 |

Compose nunca escribe en el GovCarpeta real: la pasarela apunta a un doble local (`infra/govcarpeta-stub/`). La cédula `1000000001` figura afiliada a otro operador, para probar el rechazo. Para usar el real se define `GOVCARPETA_URL`, y escribir en él exige además `GOVCARPETA_ESCRITURA=1` y permiso explícito. La verificación con la Registraduría es simulada (B-06). El despliegue en GCP sí escribe en el GovCarpeta real (ADR-0025).

Entra con **Ingresar** usando la cuenta de demostración `andres.perez.45678@carpetacolombia.co` y la clave de `USUARIO_DEMO_CLAVE`. Las empresas de demostración de Premium (HU-10) entran igual: `tramites@premium.carpetacolombia.co` (con plan) y `servicios@basico.carpetacolombia.co` (sin plan). El analista del Estado (HU-12) es `analista@mintic.carpetacolombia.co` con la misma clave.

Para trabajar en la SPA con recarga en caliente: `cd web && npm i && npm run dev` (puerto 5173, mismo emisor).

## Pruebas

```sh
npx @redocly/cli lint contratos/*.yaml   # contratos OpenAPI 3.1
cd identidad && npm i && npm test     # emisor OIDC, node:test (igual en servicios/* y libs/eventos)
# Los esquemas de eventos los valida libs/eventos/test/eventos.test.js. Los servicios usan @mcs/eventos: npm i en libs/eventos antes.
# Las pruebas de MongoDB (servicios/indice, servicios/auditoria) corren con MONGO_URL_TEST=mongodb://localhost:27018 (docker run --rm -p 27018:27017 mongo:7).
# Si agregas una base a infra/init-bases.sql, recrea el volumen (docker compose down -v) o créala a mano: docker compose exec postgres psql -U postgres -c 'CREATE DATABASE premium'
cd e2e && npm i && npx playwright install chromium && npm test   # flujos + axe, contra compose
```

## Identidad (ADR-0014)

En local la identidad la emite `identidad/`, un emisor mínimo con las mismas rutas, claims y audiencias que el realm `carpeta` de Keycloak: token de acceso con `aud: [custodia, notificaciones, indice, auditoria, autorizaciones, interoperabilidad]`, `azp: portal`, `preferred_username` y `cedula`; token de identidad con `aud: portal`. Solo admite Authorization Code con PKCE S256 y redirecciones registradas.

También expone el subconjunto del Admin API de Keycloak que usa Afiliación para crear cuentas (`client_credentials` del cliente `afiliacion-admin`; `GET`, `POST`, `PUT` y `DELETE` en `/admin/realms/carpeta/users`). Los usuarios viven en su propia base Postgres.

Cambiar a Keycloak es solo cambiar variables de entorno:

| Variable | Dónde | Valor local |
|---|---|---|
| `VITE_OIDC_AUTHORITY` | build de la SPA | `http://localhost:8081/realms/carpeta` |
| `OIDC_ISSUER` | servicios | `http://localhost:8081/realms/carpeta` |
| `OIDC_JWKS_URL` | servicios | `http://identidad:8080/realms/carpeta/protocol/openid-connect/certs` |
| `KC_INTEROP_SECRETO` | identidad e interoperabilidad | cliente de servicio `interoperabilidad` (client credentials hacia la custodia y autorizaciones) |
| `KC_CUSTODIA_SECRETO` | identidad y custodia | cliente de servicio `custodia` (client credentials hacia autorizaciones, RI-08) |
| `KEYCLOAK_URL`, `KEYCLOAK_SECRETO` | afiliación | `http://identidad:8080`, `KC_AFILIACION_SECRETO` |

## Demo en la nube (pre-entrega)

SPA: https://sjunka.github.io/EntregaArx/. Los servicios están en Cloud Run y la identidad en Keycloak (realm `carpeta`, en español). El despliegue escribe en el GovCarpeta real (ADR-0025).

- Registro: **Crear mi carpeta**. La cédula queda registrada en GovCarpeta a nombre de Mi Carpeta Segura. Afiliación admite 5 registros por hora desde una misma conexión.
- Ingreso: **Ingresar** con la cuenta de demostración o con la cuenta institucional que entrega el registro.
- Carga: **Subir documento** (PDF, JPG o PNG de hasta 10 MB). El archivo va directo a Cloud Storage por URL prefirmada.
- Autenticación: **Autenticar con GovCarpeta** en un documento temporal. GovCarpeta responde en menos de 1 s.

Validado el 24 de septiembre de 2026: HU-01 a HU-12 en GCP contra el GovCarpeta real. HU-13 funciona con un operador de otro equipo que implemente `transferCitizen`. El resumen está en `docs/despliegue-gcp-resumen.pdf` y la guía con capturas en https://claude.ai/artifact/KvS5LjWqGThgVKjwRgGjh3.

Para el resto de historias (ADR-0026), la universidad simulada está en `mcs-entidad` y los correos llegan a un Mailpit (usuario `demo`, clave de `terraform output -raw mailpit_clave`, URL de `terraform output mailpit`). `CLAVE` es la de las cuentas demo:

```sh
ENTIDAD=$(terraform -chdir=infra/terraform output -json urls | jq -r .entidad)
# HU-05: la universidad emite un certificado; el aviso llega a Mailpit
curl -X POST $ENTIDAD/emitir -H "x-demo-clave: $CLAVE" -H 'content-type: application/json' -d '{"cedula":"<cédula>","titulo":"Diploma de Ingeniería"}'
# HU-07: la universidad pide documentos; el ciudadano decide en Solicitudes
curl -X POST $ENTIDAD/peticiones -H "x-demo-clave: $CLAVE" -H 'content-type: application/json' -d '{"cedula":"<cédula>","proposito":"Verificar tus estudios","documentos":[{"titulo":"Diploma"}]}'
```

- HU-06, HU-08 y HU-11: desde la SPA del ciudadano (**Enviar** manda el correo a Mailpit).
- HU-10: **Ingresar** con `tramites@premium.carpetacolombia.co` (con plan) o `servicios@basico.carpetacolombia.co` (sin plan).
- HU-12: **Ingresar** con `analista@mintic.carpetacolombia.co`. Una región con menos de 10 diplomas sale como «Reservado».
- HU-09 y HU-13 (traslados, ADR-0027): Mi Carpeta Segura publica en GovCarpeta su `transferAPIURL` (`https://mcs-interoperabilidad-679270359263.us-east1.run.app/api/transferCitizen`) y recibe el formato del curso (`id`, `citizenName`, `citizenEmail`, `urlDocuments`, `confirmAPI`). El enlace de activación llega a Mailpit. Para HU-13, **Trasladarme** lista los operadores de GovCarpeta que publican su dirección; el traslado funciona con los que implementan `transferCitizen`.

## Despliegue en GCP (ADR-0015)

Variante económica en `mcs-entrega-2026` (us-east1): 10 servicios y Keycloak en Cloud Run, Cloud SQL `db-f1-micro`, VM `e2-small` con Kafka y Schema Registry, MongoDB Atlas M0 y la SPA en GitHub Pages (https://sjunka.github.io/EntregaArx/). Detalle en `docs/despliegue-gcp.md`.

```sh
source .env.atlas && export MONGODB_ATLAS_PUBLIC_KEY MONGODB_ATLAS_PRIVATE_KEY
infra/gcp/desplegar.sh mcs-entrega-2026        # APIs, imágenes, migraciones, esquemas y apply completo
terraform -chdir=infra/terraform output urls   # URL públicas; copiarlas a las variables VITE_* del repo
gh workflow run pages.yml                       # publica la SPA
cd e2e && SMOKE_URLS="$(terraform -chdir=../infra/terraform output -json urls)" \
  USUARIO_DEMO_CLAVE=$(terraform -chdir=../infra/terraform output -raw usuario_demo_clave) \
  BASE_URL=https://sjunka.github.io/EntregaArx/ npx playwright test smoke-gcp
terraform -chdir=infra/terraform destroy        # apagar (el proyecto Atlas y su llave se borran aparte)
```

## Trazabilidad

| Entrega | Realiza |
|---|---|
| Esqueleto (#2) | RNF-11 autenticación con OIDC y PKCE (el segundo factor se activa en el objetivo, ADR-0006), RNF-17 WCAG 2.1 AA verificado con axe |
| HU-01 Registro y afiliación | RF-01.1 registro con teléfono celular, RF-01.2 verificación de identidad (simulada, B-06), RF-01.3 afiliación única, RF-01.5 cuenta institucional, RF-06.2 registro en GovCarpeta, RD-15 y RNF-21 solo datos mínimos por la pasarela (2 KB), RI-03 nunca una segunda afiliación |
| HU-02 Ingreso | RF-09.1 ingreso con OIDC Authorization Code y PKCE, RNF-11 bloqueo de la cuenta tras 5 intentos fallidos (15 min, sin revelar si existe) y verificación de firma, emisor y audiencia en la custodia (401), RNF-10 sin contraseñas en la SPA |
| HU-03 Carga de Temporal | RF-02.2 carga de PDF, JPG o PNG (10 MB), RF-02.3 metadatos y SHA-256, RNF-24 cuota de 20 Temporales y 200 MB visible en la SPA, RI-06 el binario sube por URL prefirmada a MinIO y no pasa por el servicio (cuerpos de 2 KB) |
| HU-04 Autenticación de Temporal | RF-06.6 y RF-02.5 el titular pide a GovCarpeta autenticar su Temporal (403 a cualquier otro), RI-01 y RNF-21 a GovCarpeta solo viajan cédula, URL de lectura de 15 min y título (pasarela: 2 KB, https), Autenticado es una marca y el documento sigue Cargado y consumiendo cuota, escritura real solo con `GOVCARPETA_ESCRITURA=1` |
| HU-05 Recepción de Certificado | RF-03.2 y RF-03.3 la entidad entrega el Certificado firmado (JWS) por un contrato propio en dos pasos y el archivo sube por URL prefirmada (ADR-0017), RF-05.1 aviso por el canal que el ciudadano elige, correo (Mailpit) o SMS simulado (ADR-0016), RNF-05 aviso en menos de 2 minutos, Kafka con CloudEvents 1.0, esquemas en Schema Registry y bandeja de salida (ADR-0018), el Certificado no consume cuota ni se elimina y deja Sustituido al Temporal equivalente |
| HU-06 Consulta y descarga | RF-02.6 búsqueda por título, clase y fecha sobre el índice de carpeta (MS-05, MongoDB alimentado por eventos), RF-02.7 descarga por URL prefirmada de 60 s y cada acceso en la bitácora solo-append de MS-02, RNF-04 lista desde el índice, RNF-01 si el almacén no responde el documento sigue en la lista y se reintenta (ADR-0019) |
| HU-07 Autorización documento a documento | RF-04.3 la entidad pide documentos con una petición firmada (JWS) que el ciudadano ve con entidad, documentos y propósito, RF-04.4 aprueba documento por documento o rechaza la petición completa y la entidad solo recibe lo autorizado, RF-04.5 autorización de 72 h que se revoca de inmediato, RI-08 MS-06 decide antes de que MS-04 firme la URL de lectura y sin decisión no se firma, cada lectura de un tercero queda en la auditoría (ADR-0020) |
| HU-08 Envío a entidad no afiliada | RF-04.1 y RF-04.2 el ciudadano arma el paquete y escribe el correo de la entidad, que recibe un enlace temporal de 72 h por documento y nunca el archivo (B-14), el envío pasa por la decisión de autorizaciones (RI-08 en cada apertura del enlace) y queda en la bitácora de accesos, RF-03.4 entrega alterna por correo con reintento idempotente (retroceso exponencial, sin duplicar el correo) y confirmación de entrega al ciudadano por su canal (ADR-0021) |
| HU-09 Traslado de entrada | RF-01.8, RF-03.3, RF-03.5 y RF-03.8 el ciudadano llega desde otro operador con sus documentos en el formato del curso (`id`, `citizenName`, `citizenEmail`, `urlDocuments`, `confirmAPI`), RI-03 solo si GovCarpeta lo muestra sin operador, enlace de activación por correo con dirección y celular, afiliación tras la activación, RNF-22 la custodia calcula tipo, tamaño y SHA-256 (ADR-0027) |
| HU-10 Caso PQRS Premium | RF-07.2 y RF-07.3 la empresa Premium abre un caso y pide documentos desde él, RI-07, catálogo, casos y medición de uso en MS-11 (ADR-0022) |
| HU-11 Consulta de accesos | RF-09.4 y RF-09.5 el ciudadano ve quién consultó sus documentos y cuándo, RNF-14 |
| HU-12 Analítica anonimizada | RF-08.1, RF-08.2 y RF-08.6 el analista del Estado consulta metadatos anonimizados en MS-10, RNF-15 (ADR-0023) |
| HU-13 Traslado de salida | RF-01.7, RF-01.8, RF-03.1, RF-03.2, RF-03.5 y RF-03.8 con `transferCitizen` y `transferCitizenConfirm`, RI-01 a GovCarpeta solo viajan URL y datos de afiliación, los documentos llegan al destino antes de cerrar la cuenta (ADR-0024) |

## Eventos y entidades de prueba

Los esquemas de los eventos están en `contratos/eventos/` y el trabajo `esquemas` de compose los registra en Schema Registry. `infra/entidad-simulada/` hace de universidad: `POST http://localhost:8088/emitir` con `{ "cedula": "...", "titulo": "..." }` firma, sube y confirma un Certificado (opciones de prueba: `firmaInvalida`, `alterarArchivo`, `sinSubir`, `sinConfirmar`, `idExterno`). También pide documentos a un ciudadano con `POST /peticiones` (`{ cedula, proposito, documentos: [{ titulo }] }`) y recoge lo que autorizó con `POST /peticiones/consultar` (`{ id }`). Los correos que envía MS-09 y los envíos de MS-07 a entidades sin operador se ven en Mailpit.
