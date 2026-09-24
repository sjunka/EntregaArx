# Eventos: CloudEvents en Kafka, esquemas en Schema Registry y bandeja de salida

Estado: aceptada. Concreta AD-05 y AD-10 al implementar HU-05 (issue #7), la primera HU que usa Kafka.

**Decisión.** Los eventos son CloudEvents 1.0 en el modo binario del binding de Kafka: los atributos (`ce_id`, `ce_type`, `ce_source`, `ce_subject`, `ce_time`, `ce_dataschema`) van en cabeceras y la data, serializada con Schema Registry, en el valor. Los esquemas son JSON Schema en `contratos/eventos/` y un trabajo de compose (`esquemas`) los registra, uno por sujeto `{tema}-value`. El productor guarda el evento en una bandeja de salida, en la misma base y transacción que el hecho de negocio, y un relevo lo publica.

**Impactos e implicaciones**

- Un evento que no cumple su esquema no sale: `encode` valida antes de enviar. Los consumidores omiten con aviso lo ilegible y reintentan si su manejador falla.
- Entrega al menos una vez: los consumidores deduplican por `ce_id` (MS-09 lo hace por evento y canal).
- La bandeja de MS-03 se escribe con el hecho en una sola sentencia. La de MS-07 usa una clave de deduplicación por documento, porque el hecho vive en MS-04.
- El código de publicación y consumo vive en el paquete `libs/eventos` (`@mcs/eventos`), extraído al llegar HU-06 (ADR-0019); antes se copiaba en tres servicios.
- Kafka es `apache/kafka` en modo KRaft y Schema Registry es `confluentinc/cp-schema-registry`, un nodo cada uno, en local.

**Problema.** Elegir cómo viajan los hechos de negocio sin perderlos ni duplicar avisos.

**Contexto.** AD-05 fija Kafka y CloudEvents; el diseño de MS-07 ya lista una «bandeja de salida» y el patrón de referencia es el microservicio de email de `descomponiendo-monolito/`.

**Alcance.** MS-03, MS-07, MS-09 y compose.

**Restricciones**

- RD-11: cada productor usa su propia base para la bandeja.
- RD-02: el relevo no guarda estado; lo que falta por publicar está en la base.

**Supuestos**

- Un nodo de Kafka basta en el prototipo; el objetivo usa Managed Service for Apache Kafka (ADR-0015).

**Arquitectura de la solución.** Temas: `mcs.ciudadano.afiliado` y `mcs.documento.recibido`. La data del segundo no lleva contenido documental ni contacto.

**Análisis comparativo**

| Criterio | Bandeja de salida y esquema registrado (elegida) | Publicar directo tras el commit | JSON sin esquema registrado |
|---|---|---|---|
| RNF-07 Tolerancia a fallos | **Cumple.** Kafka caído no pierde eventos. | **No cumple.** Un fallo entre commit y envío pierde el evento. | **Cumple.** |
| RNF-19 Interoperabilidad | **Cumple.** Contrato verificable por el consumidor. | **Cumple.** | **No cumple.** Sin contrato. |
| Coste | **Parcial.** Una tabla y un relevo por productor. | **Cumple.** | **Cumple.** |

**Justificación.** Perder el aviso de un documento recibido rompe la promesa de HU-05; el esquema registrado hace verificable el contrato entre servicios.

**Consenso.** Acordado con el diseño (AD-05).

**Disenso.** Ninguno registrado.

**Decisiones relacionadas:** ADR-0005, ADR-0010, ADR-0016, ADR-0017
