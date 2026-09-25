# Despliegue en GCP (variante económica)

Sigue ADR-0015 y ADR-0014. Se despliega una sola vez, al final, en un proyecto nuevo de `us-east1`, y se destruye con `terraform destroy`.

## Qué crea `infra/terraform`

- Proyecto GCP nuevo con las APIs necesarias, Artifact Registry y una red propia (`10.10.0.0/24`).
- Cloud Run: 10 servicios (`pasarela`, `afiliacion`, `autorizaciones`, `premium`, `custodia`, `interoperabilidad`, `notificaciones`, `indice`, `auditoria`, `analitica`) y Keycloak 26 con el realm `carpeta` (`infra/keycloak/realm-carpeta.json`).
- Cloud SQL PostgreSQL 16 `db-f1-micro` con IP privada y una base por servicio (RD-11): `afiliacion`, `custodia`, `interoperabilidad`, `autorizaciones`, `premium`, `keycloak`.
- MongoDB Atlas M0 para MS-09, MS-05, MS-02 y MS-10.
- VM `e2-small` con Kafka KRaft y Schema Registry. Tiene IP externa efímera solo para bajar imágenes de Docker Hub; el firewall solo admite la subred interna.
- Dos buckets de GCS con llaves HMAC para las URL prefirmadas (RI-06).
- Secret Manager con todos los secretos, generados por Terraform. Ninguno entra al repo.
- Jobs de Cloud Run para las migraciones (RD-10) y el registro de esquemas.
- Para el demo (ADR-0026): la universidad simulada `mcs-entidad` en Cloud Run y Mailpit en la VM de Kafka (SMTP interno; la página, con usuario y clave).

La SPA se publica en GitHub Pages (AD-11) con `.github/workflows/pages.yml`.

## Pasos

1. Copiar `infra/terraform/terraform.tfvars.example` a `terraform.tfvars` y completarlo (cuenta de facturación, proyecto de Atlas, URL de Pages).
2. Exportar `MONGODB_ATLAS_PUBLIC_KEY` y `MONGODB_ATLAS_PRIVATE_KEY`, y hacer `gcloud auth application-default login`.
3. Ejecutar `infra/gcp/desplegar.sh <project_id>`. Sube las imágenes, aplica el plan, migra y registra los esquemas.
4. Copiar las URL de `terraform output urls` a las variables del repositorio `VITE_*` y lanzar el workflow `pages`.
5. Correr el smoke (cabecera de `e2e/smoke-gcp.spec.js`).
6. Al terminar: `terraform -chdir=infra/terraform destroy`.

`GOVCARPETA_ESCRITURA` queda en `1` por permiso explícito (24 de septiembre de 2026, entrega 3, ADR-0025): la pasarela registra ciudadanos y autentica documentos en el GovCarpeta real. La Registraduría sigue simulada (B-06).

## Costo estimado (us-east1, referencia de lista, no medida)

Los servicios con Kafka o bandeja de salida llevan una instancia con CPU siempre asignada; es la partida mayor.

- Cloud Run, 7 servicios con CPU siempre asignada (1 vCPU, 512 MiB) y Keycloak (1 vCPU, 1 GiB): unos 1,6 USD al día.
- Cloud Run, 3 servicios restantes: cerca de 0 sin tráfico.
- Cloud SQL `db-f1-micro`: unos 0,4 USD al día.
- VM `e2-small` con disco de 20 GB: unos 0,6 USD al día.
- GCS, Secret Manager, Artifact Registry y Cloud Build: centavos con el volumen de una demostración.
- Atlas M0: gratis.

Total: del orden de 3 USD al día, unos 90 USD por mes si se deja encendido. Para una demostración de unos días quedan por debajo de 20 USD. Verificar en la calculadora de precios de GCP antes de aplicar.

## Techos conocidos

- Atlas M0 acepta `0.0.0.0/0` porque Cloud Run no tiene IP fija; la clave es la única barrera.
- Kafka sin réplicas ni TLS, dentro de la red privada.
- Una sola instancia de Keycloak.
