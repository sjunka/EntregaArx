# Variante económica en GCP

Estado: aceptada. Se desvía de ADR-0003 (AD-03) y ADR-0008 (AD-08) solo en el despliegue del curso.

Para no agotar el crédito del curso, el despliegue en GCP (proyecto nuevo, `us-east1`, aprovisionado con Terraform en `infra/`) usa: una instancia mínima de Cloud SQL PostgreSQL con una base de datos por servicio (RD-11 se sigue cumpliendo a nivel de base de datos), MongoDB Atlas M0, y Kafka en KRaft más Schema Registry en una VM `e2-small`. La variante gestionada (Managed Service for Apache Kafka, una instancia de Cloud SQL por servicio) sigue siendo el objetivo documentado. El despliegue se hace una sola vez, al final, y se destruye con `terraform destroy`.
