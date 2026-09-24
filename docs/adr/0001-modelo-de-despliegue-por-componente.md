# Modelo de despliegue por componente

Estado: aceptada. Origen: AD-01 en `ArquitecturasAvanzadasDeSoftware/entregas-md/entrega2-carpeta-ciudadana.md` (*3.8).

**Decisión.** Todo el operador se despliega en **nube pública**. Ningún componente va on-premise ni en edge; la matriz por clase fija cómo se protege cada uno.

**Impactos e implicaciones**

- El equipo no compra ni opera hardware.
- La custodia perpetua depende de un proveedor: se mitiga con API S3 estándar y exportación.
- La transferencia internacional de datos personales debe justificarse ante la Ley 1581.

**Problema.** Decidir, componente por componente, si corre en nube pública, en un centro de datos propio, en un modelo híbrido o en el borde.

**Contexto.** Un operador nacional debe custodiar documentos a perpetuidad (RNF-03) y absorber picos de campañas (RNF-09) con un modelo de servicios básicos gratuitos (RNF-28, RI-07).

**Alcance.** Todos los componentes de *3.3: prototipo y plataforma objetivo.

**Restricciones**

- RD-06: todo se empaqueta en contenedores.
- RD-04: infraestructura inmutable.
- Ley 1581 de 2012 sobre datos personales.

**Supuestos**

- El crédito de GCP del curso cubre el prototipo.
- B-15 sigue abierto: no hay cifra de población objetivo.

**Arquitectura de la solución.** Nube pública para las siete clases de componente. Las diferencias están en el mecanismo de protección, no en la ubicación.

| Clase de componente | Modelo | Motivo |
|---|---|---|
| SPA | Nube pública · CDN | Contenido estático, sin datos personales. |
| Servicios sin estado | Nube pública · Cloud Run | Escala por peticiones y a cero (RD-02, RD-03). |
| Custodia perpetua | Nube pública · dual-region con Bucket Lock | Durabilidad sin segundo centro propio (RNF-02). |
| Identidad y llaves | Nube pública · Secret Manager y KMS | Rotación y auditoría gestionadas. |
| Auditoría | Nube pública · MongoDB solo-append | Solo se agrega, nunca se edita ni se borra (RNF-14). |
| Analítica | Nube pública · MongoDB en proyecto separado | Aislada del OLTP (RF-08). |
| Integraciones | Nube pública · pasarela | GovCarpeta ya vive en nube pública. |
| Edge | No aplica | No hay requisito de tiempo real (RI-02). |

**Análisis comparativo**

| Criterio | Nube pública (elegida) | On-premise | Híbrido |
|---|---|---|---|
| RNF-02 Durabilidad | **Cumple.** Cloud Storage dual-region replica entre regiones. | **Parcial.** Exige un segundo centro propio. | **Cumple.** Custodia en nube. |
| RNF-30 Elasticidad | **Cumple.** Escala sola hacia arriba y a cero. | **No cumple.** La capacidad se compra para el pico. | **Parcial.** Solo la parte en nube escala. |
| Coste | **Cumple.** Pago por uso y crédito del curso. | **No cumple.** Inversión inicial en hardware. | **Parcial.** Dos plataformas que operar. |
| Regulación | **Parcial.** Hay transferencia internacional; la SIC la admite hacia países con nivel adecuado. | **Cumple.** Los datos no salen de Colombia. | **Cumple.** Identidad y datos personales en local. |

**Justificación.** La nube pública cumple durabilidad, elasticidad y coste. Su único punto parcial, la regulación, se resuelve con la Circular Externa 005 de 2017 de la SIC (AD-02). El modelo híbrido duplica la operación para ganar solo en ese criterio.

**Consenso.** Acordado por el equipo en la sesión del 14 de septiembre.

**Disenso.** Se planteó mantener la identidad on-premise por soberanía. Se descartó porque el caso no lo exige y la Ley 1581 admite la transferencia con nivel adecuado.

**Decisiones relacionadas:** AD-02, AD-03, AD-04
