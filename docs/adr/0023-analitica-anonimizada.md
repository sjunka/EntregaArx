# Analítica anonimizada para el Estado

Estado: aceptada. Decidida con el usuario al implementar HU-12 (issue #14). Cierra un hueco del diseño: el evento `documento.recibido` no trae región.

**Decisión.** MS-10 consume `documento.recibido` y guarda, en su propia base MongoDB, solo institución emisora, región y año. La región es la de la institución emisora, tomada de un directorio propio de MS-10 (`REGIONES_EMISORES`); el evento y MS-07 no cambian. El tablero `GET /tableros/diplomas` (filtros `anio` y `region`) es solo para el rol analista y suprime toda celda con menos certificados que el umbral de anonimato (10, variable `UMBRAL_ANONIMATO`).

**Impactos e implicaciones**

- Lo que se descarta antes de guardar: cédula, título, id del documento y id del evento. La llave de deduplicación (la entrega del bus es al menos una vez) es un hash con sal (`ANALITICA_SAL`) del id del evento: no permite volver al evento sin la sal.
- Un emisor fuera del directorio no entra a la analítica: el directorio solo lista instituciones del contexto de educación (RF-08.4).
- El tablero no publica un total, para que no se pueda restar de él una celda suprimida, y declara su fecha de corte (eventual consistencia, RNF-06).
- Rol analista: el emisor OIDC agrega el claim `analista` (sin cédula) y la audiencia `analitica`; el token de un ciudadano no sirve en MS-10 (401) y uno válido sin el claim recibe 403.
- La SPA muestra el tablero cuando el token de identidad lleva `analista`, igual que la consola de la empresa con `empresa`.
- ponytail: se cuentan Certificados, no personas (no hay seudónimo por persona a propósito, sería dato personal); el umbral es entonces una cota superior de personas. Si se exige contar personas, agregar un seudónimo con sal por ciudadano y una nueva evaluación de riesgo.
- ponytail: el directorio de regiones vive en una variable de entorno; en el objetivo pasa a la configuración de despliegue.

**Problema.** HU-12 pide diplomas por región sin identificar a nadie, y el diseño no dice de dónde sale la región ni cómo se identifica al analista.

**Contexto.** RF-08.1 y RF-08.2 (metadatos, sin identidad), RNF-15 (Ley 1581), RD-11 (base propia) y el escenario alterno de la HU: menos de 10 personas se suprime.

**Alcance.** MS-10, el emisor OIDC, compose y la SPA.

**Restricciones**

- RD-11: MS-10 tiene su propia base y no lee las de otros servicios.
- MS-10 no está en el camino crítico de la carpeta: solo consume eventos.

**Supuestos**

- La región de la institución emisora basta para «diplomas por región».
- Un nodo de MongoDB sin autenticación basta en el prototipo local.

**Arquitectura de la solución.** Contrato: `contratos/analitica.openapi.yaml`. Puerto local 8096.

**Análisis comparativo**

| Criterio | Región del emisor en MS-10 (elegida) | Campo `region` en el evento | Región del ciudadano |
|---|---|---|---|
| RNF-15 Privacidad | **Cumple.** Ningún dato del ciudadano llega a MS-10. | **Cumple.** | **No cumple.** Un dato personal llega a la analítica. |
| RNF-26 Modificabilidad | **Cumple.** No toca el esquema ni a MS-07. | **Parcial.** Nueva versión del esquema cerrado. | **Parcial.** |
| Coste | **Cumple.** Una variable. | **Parcial.** Cambia dos servicios y el registro de esquemas. | **No cumple.** |

**Justificación.** Es la opción que no mueve datos del ciudadano ni cambia contratos existentes.

**Consenso.** El usuario eligió la región del emisor en MS-10 y el umbral configurable con 10 por defecto.

**Disenso.** Ninguno registrado.

**Decisiones relacionadas:** ADR-0008, ADR-0014, ADR-0018, ADR-0019
