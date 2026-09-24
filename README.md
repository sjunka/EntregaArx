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
| MinIO (almacén S3) | http://localhost:9000 (consola 9001) |
| Pasarela de GovCarpeta (MS-08) | http://localhost:8084 |
| GovCarpeta simulado | http://localhost:8090 |

Compose nunca escribe en el GovCarpeta real: la pasarela apunta a un doble local (`infra/govcarpeta-stub/`). La cédula `1000000001` figura afiliada a otro operador, para probar el rechazo. Para usar el real se define `GOVCARPETA_URL`, y escribir en él exige además `GOVCARPETA_ESCRITURA=1` y permiso explícito. La verificación con la Registraduría es simulada (B-06).

Entra con **Ingresar** usando la cuenta de demostración `andres.perez.45678@carpetacolombia.co` y la clave de `USUARIO_DEMO_CLAVE`.

Para trabajar en la SPA con recarga en caliente: `cd web && npm i && npm run dev` (puerto 5173, mismo emisor).

## Pruebas

```sh
npx @redocly/cli lint contratos/*.yaml   # contratos OpenAPI 3.1
cd identidad && npm i && npm test     # emisor OIDC, node:test (igual en servicios/*)
# Si agregas una base a infra/init-bases.sql, recrea el volumen: docker compose down -v
cd e2e && npm i && npx playwright install chromium && npm test   # flujos + axe, contra compose
```

## Identidad (ADR-0014)

En local la identidad la emite `identidad/`, un emisor mínimo con las mismas rutas, claims y audiencias que el realm `carpeta` de Keycloak: token de acceso con `aud: custodia`, `azp: portal`, `preferred_username` y `cedula`; token de identidad con `aud: portal`. Solo admite Authorization Code con PKCE S256 y redirecciones registradas.

También expone el subconjunto del Admin API de Keycloak que usa Afiliación para crear cuentas (`client_credentials` del cliente `afiliacion-admin`; `GET`, `POST`, `PUT` y `DELETE` en `/admin/realms/carpeta/users`). Los usuarios viven en su propia base Postgres.

Cambiar a Keycloak es solo cambiar variables de entorno:

| Variable | Dónde | Valor local |
|---|---|---|
| `VITE_OIDC_AUTHORITY` | build de la SPA | `http://localhost:8081/realms/carpeta` |
| `OIDC_ISSUER` | servicios | `http://localhost:8081/realms/carpeta` |
| `OIDC_JWKS_URL` | servicios | `http://identidad:8080/realms/carpeta/protocol/openid-connect/certs` |
| `KEYCLOAK_URL`, `KEYCLOAK_SECRETO` | afiliación | `http://identidad:8080`, `KC_AFILIACION_SECRETO` |

## Trazabilidad

| Entrega | Realiza |
|---|---|
| Esqueleto (#2) | RNF-11 autenticación con OIDC y PKCE (el segundo factor se activa en el objetivo, ADR-0006), RNF-17 WCAG 2.1 AA verificado con axe |
| HU-01 Registro y afiliación | RF-01.1 registro con teléfono celular, RF-01.2 verificación de identidad (simulada, B-06), RF-01.3 afiliación única, RF-01.5 cuenta institucional, RF-06.2 registro en GovCarpeta, RD-15 y RNF-21 solo datos mínimos por la pasarela (2 KB), RI-03 nunca una segunda afiliación |
| HU-02 Ingreso | RF-09.1 ingreso con OIDC Authorization Code y PKCE, RNF-11 bloqueo de la cuenta tras 5 intentos fallidos (15 min, sin revelar si existe) y verificación de firma, emisor y audiencia en la custodia (401), RNF-10 sin contraseñas en la SPA |
| HU-03 Carga de Temporal | RF-02.2 carga de PDF, JPG o PNG (10 MB), RF-02.3 metadatos y SHA-256, RNF-24 cuota de 20 Temporales y 200 MB visible en la SPA, RI-06 el binario sube por URL prefirmada a MinIO y no pasa por el servicio (cuerpos de 2 KB) |
