# Plataforma de cómputo

Estado: aceptada. Origen: AD-03 en `ArquitecturasAvanzadasDeSoftware/entregas-md/entrega2-carpeta-ciudadana.md` (*3.8).

**Decisión.** **Cloud Run** para los servicios y Keycloak del prototipo. En el objetivo, Keycloak y los consumidores de Kafka pasan a **GKE Autopilot** y las notificaciones a **Cloud Run functions**.

**Impactos e implicaciones**

- Sin servidores que parchear.
- Arranque en frío en servicios con cero instancias.
- Keycloak queda con una sola instancia en el prototipo.

**Problema.** Elegir dónde se ejecutan los contenedores.

**Contexto.** Criterios de la clase del 12 de septiembre: duración de los procesos, arranque en frío, carga operativa, dependencia del proveedor y tráfico sostenido frente a esporádico.

**Alcance.** Servicios, identidad y funciones.

**Restricciones**

- RD-02: procesos sin estado.
- RD-03: escalado horizontal.

**Supuestos**

- El tráfico del prototipo es esporádico.

**Arquitectura de la solución.** Manifiestos Knative declarativos por servicio. Identidad con `min-instances=1` y sidecar Cloud SQL Auth Proxy; servicios Node con `min-instances=0`; pasarela sin acceso público.

**Análisis comparativo**

| Criterio | Cloud Run (elegida) | GKE Autopilot | Compute Engine | Cloud Run functions |
|---|---|---|---|---|
| RNF-30 Elasticidad | **Cumple.** Escala por peticiones y a cero. | **Cumple.** Escalado de pods y nodos gestionado. | **No cumple.** Grupos de instancias lentos para escalar. | **Cumple.** Escala por evento. |
| RNF-29 Desplegabilidad | **Cumple.** Revisiones con tráfico dividido. | **Cumple.** Rolling update. | **Parcial.** Imágenes y scripts propios. | **Cumple.** Despliegue por función. |
| Coste | **Cumple.** Sin costo sin tráfico. | **Parcial.** Costo base del clúster siempre encendido. | **No cumple.** Se paga encendida. | **Cumple.** Pago por invocación. |
| RNF-04 Rendimiento | **Parcial.** Arranque en frío; Keycloak lo evita con una instancia mínima. | **Cumple.** Pods calientes. | **Cumple.** Sin arranque en frío. | **Parcial.** Arranque en frío y límite de duración. |

**Justificación.** Los servicios hacen procesos cortos con tráfico esporádico: es el caso de Cloud Run. GKE se reserva para lo que necesita estar siempre caliente o consumir colas de forma continua. Las funciones encajan con notificaciones, como indicó el profesor.

**Consenso.** Acordado por el equipo, siguiendo los criterios de la clase.

**Disenso.** Kubernetes para todo, como en la clase. Se pospone: el prototipo no justifica el costo base del clúster.

**Decisiones relacionadas:** AD-01, AD-06, AD-12
