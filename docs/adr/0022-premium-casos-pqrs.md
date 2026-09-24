# Premium: casos PQRS, sesión de empresa y medición de uso en MS-11

Estado: aceptada. Decidida con el usuario al implementar HU-10 (issue #12). Concreta RF-07.2, RF-07.3 y RI-07; cierra huecos que el diseño de HU-10 deja abiertos.

**Decisión.** MS-11 (`servicios/premium/`, base propia `premium` en Postgres, puerto 8095) guarda el catálogo Premium, las empresas con su plan, los casos PQRS, las peticiones de cada caso y el uso medido. La empresa entra a una consola de la SPA con una cuenta del emisor OIDC: su token lleva el claim `empresa`, la audiencia `premium` y ninguna otra. Abrir un caso y pedir documentos desde él exigen plan Premium; sin plan MS-11 responde 403 `Plan Premium requerido`, no crea ni mide nada y la SPA ofrece el catálogo. La petición del caso la envía MS-11 a `POST /interno/peticiones` de MS-06 con su token de servicio; la entidad es el id de la empresa. Desde ahí es igual a la de HU-07: el ciudadano la ve en Solicitudes y autoriza documento a documento (RI-08).

**Impactos e implicaciones**

- MS-06 admite `azp: premium` además de `interoperabilidad` en `POST` y `GET /interno/peticiones`; `/interno/decisiones` sigue siendo solo de la custodia. El emisor gana el cliente de servicio `premium` (`KC_PREMIUM_SECRETO`, audiencia `autorizaciones`).
- El emisor gana la columna `usuarios.empresa`. El token de una cuenta de empresa lleva `empresa` en lugar de `cedula` y solo la audiencia `premium`, así que no sirve en la custodia ni en las rutas del ciudadano. El token de identidad lleva `empresa` para que la SPA sepa qué consola abrir. Keycloak lo resuelve con un atributo de usuario y un mapeador.
- El uso se mide en la misma transacción que el caso o la petición (`uso`: empresa, servicio, caso, petición). Una petición se mide solo después de que MS-06 la aceptó: si MS-06 no responde, MS-11 responde 502 y no queda nada medido ni creado. Solo hay servicios de empresa en el catálogo, y ninguna operación del ciudadano pasa por MS-11 (RI-07).
- MS-11 conserva el id que MS-06 asignó a la petición; con él consulta su estado (`pendiente`, `atendida`, `rechazada`) al listar los casos. Si MS-06 no responde, muestra el último estado conocido.
- Las empresas, sus planes y el catálogo se siembran en la migración de MS-11 y sus cuentas en la de identidad (demostración). No hay contratación ni facturación todavía: RF-07.1 y RF-07.5 no entran en HU-10.
- El diseño dice que MS-11 emite el evento `uso medido`. Ningún consumidor lo necesita todavía, así que no se publica; se agrega, con su esquema y la bandeja de salida de ADR-0018, cuando una historia lo pida (como con las decisiones de MS-06 en ADR-0020).
- La empresa no recoge documentos desde MS-11: HU-10 pide abrir, pedir y ver el estado. Recoger lo autorizado seguiría el `GET /api/peticiones/{id}` de MS-07 (ADR-0020).
- Sin canal federado: la petición no comprueba en qué operador está el ciudadano (RF-07.3 pide que funcione con cualquiera). Con un ciudadano de otro operador queda pendiente. Se agrega con el traslado de salida (HU-13).
- ponytail: proveedor de token de servicio copiado por tercera vez (custodia, interoperabilidad, premium); extraer a un paquete en el siguiente cambio que lo toque.

**Problema.** El diseño de HU-10 no dice cómo se autentica la empresa, dónde vive su plan, por dónde llega la petición a MS-06 ni qué se mide.

**Contexto.** ADR-0020 ya dio a las entidades una petición con autorización por documento; el catálogo y los planes no tienen aún consola de administración.

**Alcance.** MS-11, MS-06, el emisor OIDC, compose y la SPA.

**Restricciones**

- RI-08: la petición de una empresa pasa por MS-06 como cualquier otra.
- RD-11: MS-11 no lee la base de MS-06 ni al revés.
- RI-07: el ciudadano no paga ni se mide.

**Análisis comparativo**

| Criterio | Sesión OIDC de empresa + MS-11 llama a MS-06 (elegida) | JWS con llave de directorio, como las entidades |
|---|---|---|
| Consola para el usuario de la empresa | **Cumple.** Ingresa con su cuenta y usa la SPA. | **No cumple.** Sin UI; solo API. |
| RNF-19 Interoperabilidad | **Cumple.** Emisor intercambiable con Keycloak (ADR-0014). | **Cumple.** Mismo estándar que ADR-0017. |
| Seguridad | **Cumple.** Audiencia propia; el token no sirve en la carpeta. | **Cumple.** Firma por petición. |
| Coste | **Parcial.** Columna y cliente nuevos en el emisor. | **Cumple.** Sin cambios en el emisor. |

**Justificación.** Un caso lo abre una persona de la empresa desde una pantalla; una firma por petición sirve a sistemas, no a personas. La API de integración con JWS (RF-07.4) queda para otra historia.

**Consenso.** El usuario eligió sesión OIDC de empresa, petición vía `/interno/peticiones` de MS-06 y consola mínima con catálogo sembrado.

**Disenso.** Ninguno registrado.

**Decisiones relacionadas:** ADR-0006, ADR-0014, ADR-0017, ADR-0020
