# GovCarpeta real en el despliegue de GCP

Estado: aceptada (24 de septiembre de 2026, con permiso explícito del responsable). Complementa ADR-0015.

La entrega 3 se sustenta en vivo con registro, ingreso, carga y autenticación contra el GovCarpeta del curso. Por eso la pasarela de GCP corre con `GOVCARPETA_ESCRITURA=1` (`infra/terraform/servicios.tf`). Compose sigue usando el doble local y nunca escribe en el real.

Las cédulas de prueba que registran las pruebas (`98…`, `99…` y `1000000001`) se quedan en GovCarpeta a propósito, para que el equipo tenga datos con los que probar. No se borran con `unregisterCitizen`.

Dos ajustes salieron de la validación en la nube:

- La SPA espera, hasta 10 s, a que el índice de carpeta (ADR-0019) tenga el documento recién subido antes de volver a la carpeta. En la nube el evento de Kafka tarda unos 3 s y sin la espera la lista salía vacía. Si el índice no responde, la SPA vuelve igual (RNF-01).
- El realm `carpeta` de Keycloak usa `defaultLocale` `es`, con el tema estándar de Keycloak. Un tema propio con el diseño de la SPA queda fuera de alcance.

## Consecuencias

- Cada corrida del e2e contra GCP deja ciudadanos reales en GovCarpeta a nombre de Mi Carpeta Segura.
- En GCP, HU-01 alterno y HU-02 bloqueo dependen de datos y textos del doble y del emisor simulado. Tampoco pasan dos aserciones de HU-03 y HU-04 (URL de MinIO local y texto del doble). Lo que valida la nube es `smoke-gcp` y el recorrido de la interfaz.
