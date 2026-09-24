# Empaquetado, registro, IaC y observabilidad

Estado: aceptada. Origen: AD-12 en `ArquitecturasAvanzadasDeSoftware/entregas-md/entrega2-carpeta-ciudadana.md` (*3.8).

**Decisión.** Imágenes **OCI multi-arquitectura** publicadas en **Docker Hub** y tomadas por Cloud Run a través de un **repositorio remoto de Artifact Registry**; infraestructura como manifiestos **Knative YAML**; logs JSON a stdout y chequeos de salud.

**Impactos e implicaciones**

- El mismo artefacto corre en local y en nube (RD-07).
- Sin estado de Terraform que custodiar.

**Problema.** Decidir cómo se construye, publica, despliega y observa cada servicio.

**Contexto.** El profesor pidió Docker Hub en el entorno académico e IaC declarativa. Cloud Run solo toma Docker Hub directamente para imágenes oficiales.

**Alcance.** Todos los servicios del prototipo.

**Restricciones**

- RD-04: infraestructura inmutable.
- RD-07: separación de construcción y ejecución.
- RD-13: observabilidad desde el primer despliegue.

**Supuestos**

- El límite de descargas de Docker Hub se evita con el repositorio remoto y credenciales.

**Arquitectura de la solución.** `docker buildx` para amd64 y arm64, `gcloud run services replace` con un YAML por servicio y `bootstrap.sh` idempotente para lo que se crea una sola vez.

**Análisis comparativo**

| Criterio | Docker Hub + Artifact Registry remoto + YAML Knative (elegida) | Artifact Registry + Terraform | Despliegue desde código fuente |
|---|---|---|---|
| RNF-29 Desplegabilidad | **Cumple.** Mismo artefacto en local y nube. | **Cumple.** Plan y aplicación reproducibles. | **Parcial.** Cada despliegue reconstruye. |
| RNF-25 Observabilidad | **Cumple.** Logs JSON que Cloud Logging indexa. | **Cumple.** Mismos logs. | **Parcial.** Sin control del artefacto. |
| Coste | **Cumple.** Registro gratuito y sin estado de IaC. | **Parcial.** Curva y backend de estado. | **Cumple.** Nada que configurar. |
| RNF-27 Libertad tecnológica | **Cumple.** Imágenes que corren en cualquier plataforma. | **Parcial.** Registro atado a GCP. | **No cumple.** Sin imagen portable. |

**Justificación.** Cumple lo que pidió el profesor y los cuatro criterios. Terraform se reserva para la plataforma objetivo, donde el número de recursos lo justifica.

**Consenso.** Acordado por el equipo.

**Disenso.** Terraform desde el inicio. Se pospuso por tiempo de entrega; los YAML de Knative ya son declarativos.

**Decisiones relacionadas:** AD-03, AD-07
