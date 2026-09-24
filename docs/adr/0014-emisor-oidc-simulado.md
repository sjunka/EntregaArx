# Emisor OIDC simulado intercambiable con Keycloak

Estado: aceptada. Complementa ADR-0006 (AD-06).

En local la identidad la emite un servicio mínimo que firma JWT y publica su JWKS con los mismos claims y audiencias que el realm de Keycloak. Los servicios y la SPA (`oidc-client-ts` con PKCE) no distinguen entre los dos emisores: el cambio se hace solo con variables de entorno (`OIDC_ISSUER`, `OIDC_JWKS_URL`). El despliegue en GCP usa Keycloak real. Se descartó una bandera que desactivara la verificación en los servicios, porque habría dejado una ruta sin seguridad en el código de producción.
