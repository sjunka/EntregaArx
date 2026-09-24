# Contratos y formatos

Estado: aceptada. Origen: AD-10 en `ArquitecturasAvanzadasDeSoftware/entregas-md/entrega2-carpeta-ciudadana.md` (*3.8).

**Decisión.** **OpenAPI 3.1** antes del código, errores **application/problem+json** (RFC 9457) y eventos **CloudEvents 1.0**.

**Impactos e implicaciones**

- El validador comprueba que cada endpoint de una secuencia existe en el contrato.
- Los errores son legibles por máquina y por persona.

**Problema.** Elegir cómo se describen APIs, errores y eventos.

**Contexto.** RD-08 exige diseño API-first y RNF-19 contratos estándar entre operadores.

**Alcance.** Todas las API propias y eventos.

**Restricciones**

- RD-08: diseño API-first.

**Supuestos**

- Los operadores pares aceptan JSON sobre HTTPS.

**Arquitectura de la solución.** Un archivo `operador/contratos/*.openapi.yaml` por servicio.

**Análisis comparativo**

| Criterio | OpenAPI + RFC 9457 + CloudEvents (elegida) | gRPC + Protobuf | Formatos propios |
|---|---|---|---|
| RNF-19 Interoperabilidad | **Cumple.** Estándares abiertos que cualquier operador lee. | **Parcial.** El navegador necesita un proxy. | **No cumple.** Cada par los tendría que aprender. |
| RNF-26 Modificabilidad | **Cumple.** Contrato primero, código después. | **Cumple.** Esquema estricto. | **Parcial.** Sin herramienta que los valide. |
| RNF-25 Observabilidad | **Cumple.** Errores con type e instance correlacionables. | **Parcial.** Errores menos legibles fuera de gRPC. | **No cumple.** Errores sin estructura. |

**Justificación.** Son los estándares que ya entienden navegadores, gateways y herramientas de observabilidad.

**Consenso.** Acordado por el equipo.

**Disenso.** Ninguno registrado.

**Decisiones relacionadas:** AD-05, AD-09
