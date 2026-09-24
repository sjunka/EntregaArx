# Mi Carpeta Segura

Operador de Carpeta Ciudadana (curso Arquitecturas Avanzadas de Software). Glosario en `CONTEXT.md`, decisiones en `docs/adr/`.

## Arranque local

Requiere Docker y Node 22.

```sh
cp .env.example .env          # y cambia las claves
docker compose up -d --build
```

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
| Entidad emisora simulada | http://localhost:8088 |
| MinIO (almacén S3) | http://localhost:9000 (consola 9001) |
| Schema Registry | http://localhost:8085 |
| Mailpit (correos de prueba) | http://localhost:8025 |
| Pasarela de GovCarpeta (MS-08) | http://localhost:8084 |
| GovCarpeta simulado | http://localhost:8090 |

Compose nunca escribe en el GovCarpeta real: la pasarela apunta a un doble local (`infra/govcarpeta-stub/`). La cédula `1000000001` figura afiliada a otro operador, para probar el rechazo. Para usar el real se define `GOVCARPETA_URL`, y escribir en él exige además `GOVCARPETA_ESCRITURA=1` y permiso explícito. La verificación con la Registraduría es simulada (B-06).

Entra con **Ingresar** usando la cuenta de demostración `andres.perez.45678@carpetacolombia.co` y la clave de `USUARIO_DEMO_CLAVE`.

Para trabajar en la SPA con recarga en caliente: `cd web && npm i && npm run dev` (puerto 5173, mismo emisor).

## Pruebas

```sh
npx @redocly/cli lint contratos/*.yaml   # contratos OpenAPI 3.1
cd identidad && npm i && npm test     # emisor OIDC, node:test (igual en servicios/* y libs/eventos)
# Los esquemas de eventos los valida libs/eventos/test/eventos.test.js. Los servicios usan @mcs/eventos: npm i en libs/eventos antes.
# Las pruebas de MongoDB (servicios/indice, servicios/auditoria) corren con MONGO_URL_TEST=mongodb://localhost:27018 (docker run --rm -p 27018:27017 mongo:7).
# Si agregas una base a infra/init-bases.sql, recrea el volumen: docker compose down -v
cd e2e && npm i && npx playwright install chromium && npm test   # flujos + axe, contra compose
```

## Identidad (ADR-0014)

En local la identidad la emite `identidad/`, un emisor mínimo con las mismas rutas, claims y audiencias que el realm `carpeta` de Keycloak: token de acceso con `aud: [custodia, notificaciones]`, `azp: portal`, `preferred_username` y `cedula`; token de identidad con `aud: portal`. Solo admite Authorization Code con PKCE S256 y redirecciones registradas.

También expone el subconjunto del Admin API de Keycloak que usa Afiliación para crear cuentas (`client_credentials` del cliente `afiliacion-admin`; `GET`, `POST`, `PUT` y `DELETE` en `/admin/realms/carpeta/users`). Los usuarios viven en su propia base Postgres.

Cambiar a Keycloak es solo cambiar variables de entorno:

| Variable | Dónde | Valor local |
|---|---|---|
| `VITE_OIDC_AUTHORITY` | build de la SPA | `http://localhost:8081/realms/carpeta` |
| `OIDC_ISSUER` | servicios | `http://localhost:8081/realms/carpeta` |
| `OIDC_JWKS_URL` | servicios | `http://identidad:8080/realms/carpeta/protocol/openid-connect/certs` |
| `KC_INTEROP_SECRETO` | identidad e interoperabilidad | cliente de servicio `interoperabilidad` (client credentials hacia la custodia) |
| `KEYCLOAK_URL`, `KEYCLOAK_SECRETO` | afiliación | `http://identidad:8080`, `KC_AFILIACION_SECRETO` |

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

## Eventos y entidades de prueba

Los esquemas de los eventos están en `contratos/eventos/` y el trabajo `esquemas` de compose los registra en Schema Registry. `infra/entidad-simulada/` hace de universidad: `POST http://localhost:8088/emitir` con `{ "cedula": "...", "titulo": "..." }` firma, sube y confirma un Certificado (opciones de prueba: `firmaInvalida`, `alterarArchivo`, `sinSubir`, `sinConfirmar`, `idExterno`). Los correos que envía MS-09 se ven en Mailpit.
