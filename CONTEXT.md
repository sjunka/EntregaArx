# Mi Carpeta Segura

Operador de Carpeta Ciudadana: custodia los documentos de los ciudadanos afiliados y los comparte con terceros según su consentimiento.

## Language

**Operador**:
Empresa habilitada que custodia carpetas ciudadanas. Mi Carpeta Segura es nuestro operador.
_Avoid_: proveedor, plataforma

**GovCarpeta**:
Centralizador de MinTIC que registra a qué operador pertenece cada ciudadano y autentica documentos.
_Avoid_: centralizador (solo como descripción), MinTIC

**Ciudadano afiliado**:
Ciudadano registrado en GovCarpeta con este operador. Solo puede estar afiliado a un operador a la vez.

**Carpeta**:
Conjunto de documentos de un ciudadano afiliado custodiados por el operador.

**Traslado**:
Cambio de operador de un ciudadano afiliado, con sus documentos. De entrada (HU-09) o de salida (HU-13).
_Avoid_: migración, portabilidad

**Documento**:
Archivo en una carpeta. Tiene una clase, **Temporal** o **Certificado**, y cada clase tiene su propio ciclo de vida.

**Temporal**:
Documento que sube el propio ciudadano. Consume cuota y el titular puede eliminarlo. Estados: Cargado, Sustituido (cuando llega el Certificado equivalente), Eliminado.
_Avoid_: borrador, provisional

**Certificado**:
Documento que emite y firma una entidad. No consume cuota y se custodia a perpetuidad sin alteración. Estados: Recibido, Verificado, Vigente, Rechazado, Retirado.
_Avoid_: emitido, oficial, firmado

**Autenticado**:
Marca de un Temporal que GovCarpeta ya autenticó. Es una constancia, no un estado: el documento sigue Cargado y sigue siendo Temporal.

## Relationships

- Un **Ciudadano afiliado** tiene exactamente una **Carpeta** en un solo **Operador**
- Un **Temporal** Sustituido queda enlazado al **Certificado** que lo reemplaza
- **GovCarpeta** registra la afiliación y autentica documentos, pero nunca recibe su contenido

## Example dialogue

> **Dev:** "Si el ciudadano autentica su diploma escaneado, ¿deja de contar en la cuota?"
> **Experto:** "No. Sigue siendo **Temporal**, solo que **Autenticado**. Sale de la cuota cuando la universidad envía el **Certificado** y el Temporal queda Sustituido."
