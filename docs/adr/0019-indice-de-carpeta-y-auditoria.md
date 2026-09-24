# Índice de carpeta, auditoría de accesos y paquete de eventos

Estado: aceptada. Decidida con el usuario al implementar HU-06 (issue #8). Concreta AD-05 y AD-08, y cumple la condición que fijó el ADR-0018 para extraer el código de eventos.

**Decisión.** La lista y la búsqueda de la Carpeta salen de MS-05, una proyección en MongoDB alimentada por eventos de MS-04 y MS-07. La descarga la entrega MS-04 con una URL prefirmada de 60 segundos y publica un evento de acceso que MS-02 agrega a una bitácora solo-append en MongoDB. El código común de eventos (bandeja, publicador, relevo, consumidor) pasa al paquete `libs/eventos` (`@mcs/eventos`).

**Impactos e implicaciones**

- Eventos nuevos de MS-04 (CloudEvents, esquemas en `contratos/eventos/`): `documento.cargado`, `documento.autenticado`, `documento.eliminado` y `acceso.registrado`. MS-04 gana su bandeja de salida y el relevo hacia Kafka; el hecho y el evento se escriben en una transacción.
- `documento.eliminado` no figura en el diseño (MS-05 consume «cargado, recibido y autenticado»): sin él un Temporal eliminado seguiría en la lista. Es un hueco del diseño que se cierra aquí.
- Consistencia eventual: el índice refleja un cambio 1 a 2 segundos después de la custodia. La SPA refresca la lista cada 4 s y conserva lo que el ciudadano acaba de hacer (autenticar) hasta que el índice lo alcance.
- Los Certificados llegan al índice por `documento.recibido`, que no lleva tipo ni tamaño (cambiar su esquema cerrado no es compatible hacia atrás en Schema Registry). La lista muestra el tamaño solo cuando existe.
- Los proyectores de MS-05 son idempotentes y admiten eventos fuera de orden entre temas (`sustituido` o `eliminado` antes que `cargado`).
- MS-02 no ofrece ninguna operación que cambie o borre: `GET /accesos` y 405 para cualquier otro método. El índice único por `ce_id` hace idempotente la entrega al menos una vez. `GET /accesos` (interfaz de MS-02 en el diseño) se adelanta a HU-11 solo como API; la pantalla es de HU-11.
- Si el almacén no responde, MS-04 no firma ni registra el acceso: un acceso que no ocurrió no se audita.
- El emisor OIDC agrega las audiencias `indice` y `auditoria` al token del ciudadano.
- ponytail: la inalterabilidad es por interfaz; en el objetivo se suma un usuario de MongoDB con solo `insert` y `find` sobre la colección.

**Problema.** HU-06 pide buscar, descargar con enlace temporal y auditar cada descarga, y el diseño reparte eso entre tres servicios que aún no existen, sin fijar los eventos que los conectan.

**Contexto.** RNF-04 (lista en menos de 2 s en p95) exige separar la lectura de la escritura (CQRS, AD-05); RF-02.7 exige registrar el acceso; ADR-0018 previó extraer `eventos.js` a un paquete si aparecía un cuarto servicio y HU-06 agrega tres más.

**Alcance.** MS-04, MS-05, MS-02, `libs/eventos`, el emisor OIDC, compose y la SPA.

**Restricciones**

- RD-11: MS-05 y MS-02 tienen su propia base MongoDB y no leen la de MS-04.
- RI-06: el binario viaja por URL prefirmada; ningún servicio lo lee.
- RD-02: el estado está en las bases, no en los procesos.

**Supuestos**

- Un nodo de MongoDB sin autenticación basta en el prototipo local.
- La URL de descarga dura 60 segundos: alcanza para abrirla y el navegador la usa al momento.

**Arquitectura de la solución.** Contratos: `contratos/indice.openapi.yaml`, `contratos/auditoria.openapi.yaml`, la ruta `GET /documentos/{id}/descarga` de `contratos/custodia.openapi.yaml` y los esquemas de eventos. Puertos locales: MS-05 en 8091 y MS-02 en 8092.

**Análisis comparativo**

| Criterio | Índice por eventos y paquete común (elegida) | Listar desde MS-04 | Copiar `eventos.js` en cada servicio |
|---|---|---|---|
| RNF-04 Rendimiento | **Cumple.** La lectura no compite con las escrituras y tiene su índice. | **Parcial.** La consulta comparte base con la carga. | **Cumple.** |
| RNF-26 Modificabilidad | **Cumple.** Un cambio del bus se hace en un solo lugar. | **Cumple.** | **No cumple.** Siete copias que deben cambiar a la vez. |
| Fidelidad al diseño | **Cumple.** MS-05 y MS-02 existen como se diseñaron. | **No cumple.** MS-05 sobra. | **Cumple.** |
| Coste | **Parcial.** Dos servicios y un paquete más, con contexto de build en la raíz. | **Cumple.** | **Cumple** ahora, deuda después. |

**Justificación.** El diseño ya separa la lectura y la auditoría en servicios propios; el paquete cumple la condición que el ADR-0018 dejó escrita.

**Consenso.** El usuario eligió el paquete compartido.

**Disenso.** Ninguno registrado.

**Decisiones relacionadas:** ADR-0005, ADR-0008, ADR-0016, ADR-0018
