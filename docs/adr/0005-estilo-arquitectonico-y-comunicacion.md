# Estilo arquitectónico y comunicación

Estado: aceptada. Origen: AD-05 en `ArquitecturasAvanzadasDeSoftware/entregas-md/entrega2-carpeta-ciudadana.md` (*3.8).

**Decisión.** **Microservicios** según la granularidad del SRS. Las cuatro operaciones del prototipo son **REST síncrono**; en el objetivo los hechos de negocio viajan por **Kafka**.

**Impactos e implicaciones**

- Cada servicio se despliega y escala solo.
- Aparece consistencia eventual en avisos y analítica.

**Problema.** Elegir estilo y forma de comunicación entre piezas.

**Contexto.** El SRS ya dio veredicto por dominio (*3.8 de A1). La afiliación exige consistencia fuerte; el resto admite eventual (RNF-06).

**Alcance.** Todo el operador.

**Restricciones**

- RD-12: descomposición por capacidad de negocio.
- RD-11: sin base de datos compartida.

**Supuestos**

- Kafka no es necesario para las cuatro operaciones implementadas.

**Arquitectura de la solución.** Llamadas REST con timeout donde el usuario espera respuesta; eventos CloudEvents donde basta con enterarse.

**Análisis comparativo**

| Criterio | Microservicios, REST y eventos (elegida) | Monolito modular | Microservicios solo síncronos |
|---|---|---|---|
| RNF-07 Tolerancia a fallos | **Cumple.** Fallos aislados y colas que absorben caídas. | **No cumple.** Un fallo tumba todo. | **Parcial.** Cascadas de timeouts. |
| RNF-26 Modificabilidad | **Cumple.** Cada dominio cambia solo. | **Parcial.** Módulos acoplados en el despliegue. | **Cumple.** Cada dominio cambia solo. |
| RNF-06 Consistencia | **Parcial.** Eventual en avisos; fuerte en afiliación. | **Cumple.** Transacción local. | **Cumple.** Respuesta inmediata. |
| Coste | **Parcial.** Más piezas que operar. | **Cumple.** Una sola pieza. | **Parcial.** Más piezas que operar. |

**Justificación.** La tolerancia a fallos con 70 operadores ajenos pesa más que la simplicidad del monolito. Kafka se deja fuera del prototipo porque ninguna de sus cuatro operaciones lo necesita.

**Consenso.** Acordado por el equipo.

**Disenso.** Monolito modular para el prototipo. Se descartó porque no demostraría la arquitectura que se entrega.

**Decisiones relacionadas:** AD-09, AD-10
