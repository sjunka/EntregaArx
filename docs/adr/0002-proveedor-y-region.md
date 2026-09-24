# Proveedor y región

Estado: aceptada. Origen: AD-02 en `ArquitecturasAvanzadasDeSoftware/entregas-md/entrega2-carpeta-ciudadana.md` (*3.8).

**Decisión.** **Google Cloud** en la región `us-east1`, con `us-central1` como par para recuperación.

**Impactos e implicaciones**

- Se usa el crédito de USD 300 del curso.
- Los datos personales residen en EE. UU.

**Problema.** Elegir proveedor de nube y región principal.

**Contexto.** GovCarpeta corre en Heroku, en EE. UU. El curso entrega crédito de GCP y usará Kafka en GCP en la próxima sesión.

**Alcance.** Prototipo y plataforma objetivo.

**Restricciones**

- Ley 1581 de 2012 y Circular Externa 005 de 2017 de la SIC.
- Presupuesto: crédito del curso.

**Supuestos**

- La latencia desde Colombia a us-east1 es aceptable para RNF-04.

**Arquitectura de la solución.** Proyecto GCP único para el prototipo en us-east1; en el objetivo, recursos regionales duplicados en us-central1.

**Análisis comparativo**

| Criterio | GCP us-east1 (elegida) | AWS us-east-1 | GCP southamerica-east1 |
|---|---|---|---|
| Coste | **Cumple.** Crédito del curso y precios de nivel 1. | **Parcial.** Sin crédito del curso. | **Parcial.** Región de precio mayor que nivel 1. |
| RNF-04 Rendimiento | **Cumple.** Cerca de GovCarpeta: menos viajes largos por operación. | **Cumple.** Misma cercanía a GovCarpeta. | **Parcial.** Cerca del ciudadano, lejos del centralizador. |
| Regulación | **Cumple.** La SIC reconoce a EE. UU. con nivel adecuado. | **Cumple.** Mismo país. | **Parcial.** Hay que verificar el nivel de protección de Brasil ante la SIC. |
| RNF-23 Recuperabilidad | **Cumple.** us-central1 como región par. | **Cumple.** us-west-2 como par. | **Cumple.** southamerica-west1 como par. |

**Justificación.** us-east1 es la única opción que cumple los cuatro criterios. AWS empata en técnica pero pierde el crédito; São Paulo gana en cercanía al ciudadano pero cada operación viaja dos veces al norte para hablar con GovCarpeta.

**Consenso.** Acordado por el equipo.

**Disenso.** Se defendió São Paulo por percepción de soberanía; pesó más la cercanía al centralizador.

**Decisiones relacionadas:** AD-01, AD-03
