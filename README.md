# Mi Carpeta Segura

Operador de Carpeta Ciudadana (curso Arquitecturas Avanzadas de Software). Glosario en `CONTEXT.md`, decisiones en `docs/adr/`.

## Arranque local

Requiere Docker y Node 22.

```sh
cp .env.example .env          # y cambia USUARIO_DEMO_CLAVE
docker compose up -d --build
```

| Servicio | URL |
|---|---|
| SPA | http://localhost:4173 |
| Emisor OIDC simulado | http://localhost:8081/realms/carpeta |

Entra con **Ingresar** usando la cuenta de demostración `andres.perez.45678@carpetacolombia.co` y la clave de `USUARIO_DEMO_CLAVE`.

Para trabajar en la SPA con recarga en caliente: `cd web && npm i && npm run dev` (puerto 5173, mismo emisor).

## Pruebas

```sh
cd identidad && npm i && npm test     # emisor OIDC, node:test
cd e2e && npm i && npx playwright install chromium && npm test   # flujos + axe, contra compose
```

## Identidad (ADR-0014)

En local la identidad la emite `identidad/`, un emisor mínimo con las mismas rutas, claims y audiencias que el realm `carpeta` de Keycloak: token de acceso con `aud: custodia`, `azp: portal`, `preferred_username` y `cedula`; token de identidad con `aud: portal`. Solo admite Authorization Code con PKCE S256 y redirecciones registradas.

Cambiar a Keycloak es solo cambiar variables de entorno:

| Variable | Dónde | Valor local |
|---|---|---|
| `VITE_OIDC_AUTHORITY` | build de la SPA | `http://localhost:8081/realms/carpeta` |
| `OIDC_ISSUER` | servicios | `http://localhost:8081/realms/carpeta` |
| `OIDC_JWKS_URL` | servicios | `http://identidad:8080/realms/carpeta/protocol/openid-connect/certs` |

## Trazabilidad

| Entrega | Realiza |
|---|---|
| Esqueleto (#2) | RNF-11 autenticación con OIDC y PKCE (el segundo factor se activa en el objetivo, ADR-0006), RNF-17 WCAG 2.1 AA verificado con axe |
