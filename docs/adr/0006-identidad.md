# Identidad

Estado: aceptada. Origen: AD-06 en `ArquitecturasAvanzadasDeSoftware/entregas-md/entrega2-carpeta-ciudadana.md` (*3.8).

**Decisión.** **Keycloak 26** con OIDC Authorization Code y PKCE para el portal y client credentials entre servicios.

**Impactos e implicaciones**

- Hay que operar Keycloak y su base.
- Los servicios solo validan JWT con llaves públicas.

**Problema.** Elegir cómo se autentican ciudadanos y servicios.

**Contexto.** RNF-11 exige autenticación sólida y RNF-12 un modelo expresivo de autorización. El portal es una aplicación pública sin secretos.

**Alcance.** MS-01 y todos sus clientes.

**Restricciones**

- RD-01: configuración fuera del artefacto.

**Supuestos**

- MFA se activa en el objetivo, no en el prototipo.

**Arquitectura de la solución.** Realm `carpeta` importado con variables, cliente público `portal` con PKCE S256, audiencia `custodia`, bloqueo tras 5 intentos, sesión inactiva de 30 minutos, tema en español.

**Análisis comparativo**

| Criterio | Keycloak (elegida) | Identity Platform | Servicio propio |
|---|---|---|---|
| RNF-11 Autenticación | **Cumple.** OIDC, fuerza bruta y MFA. | **Cumple.** OIDC y MFA gestionados. | **Parcial.** Reinventar seguridad. |
| RNF-12 Autorización | **Cumple.** Roles y mapeadores de atributos. | **Parcial.** Claims propios vía funciones. | **Parcial.** Todo por construir. |
| Coste | **Parcial.** Hay que operarlo. | **Cumple.** Pago por usuario activo, sin operación. | **No cumple.** Desarrollo y auditoría. |
| RNF-27 Libertad tecnológica | **Cumple.** Estándar abierto que corre en cualquier nube. | **No cumple.** Atado a GCP. | **Cumple.** Sin proveedor. |

**Justificación.** Keycloak es el único que cumple autenticación, autorización expresiva y portabilidad a la vez. Su costo operativo se acota con una instancia en el prototipo y HA en GKE en el objetivo.

**Consenso.** Acordado por el equipo.

**Disenso.** Identity Platform ahorra operación; se rechazó por dependencia del proveedor.

**Decisiones relacionadas:** AD-03, AD-07
