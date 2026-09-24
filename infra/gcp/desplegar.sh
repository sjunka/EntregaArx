#!/usr/bin/env bash
# Despliegue único en GCP (ADR-0015). Uso: infra/gcp/desplegar.sh <project_id>
# Requiere gcloud autenticado, terraform y infra/terraform/terraform.tfvars. Las llaves de Atlas van en
# MONGODB_ATLAS_PUBLIC_KEY y MONGODB_ATLAS_PRIVATE_KEY. Nada de esto se versiona.
set -euo pipefail
P=${1:?uso: desplegar.sh <project_id>}
R=us-east1
TAG=${IMAGEN_TAG:-latest}
cd "$(dirname "$0")/../.."
TF="terraform -chdir=infra/terraform"

# 1. Proyecto, APIs y registro. El resto del plan necesita las imágenes, que aún no existen.
$TF init
$TF apply -target=google_project_service.api -target=google_artifact_registry_repository.mcs

# 2. Imágenes. Servicios con libs/eventos se construyen con la raíz como contexto.
build() { # nombre contexto dockerfile
  gcloud builds submit "$2" --project "$P" --region "$R" --config <(printf 'steps:\n- name: gcr.io/cloud-builders/docker\n  args: [build, -t, "%s", -f, "%s", .]\nimages: ["%s"]\n' \
    "$R-docker.pkg.dev/$P/mcs/$1:$TAG" "$3" "$R-docker.pkg.dev/$P/mcs/$1:$TAG")
}
for s in afiliacion analitica auditoria custodia indice interoperabilidad notificaciones; do build "$s" . "servicios/$s/Dockerfile"; done
for s in autorizaciones pasarela premium; do build "$s" "servicios/$s" Dockerfile; done
build keycloak infra/keycloak Dockerfile
build esquemas . infra/gcp/esquemas.Dockerfile

# 3. Bases, Kafka y jobs primero: migraciones (RD-10) y esquemas corren antes de que existan los servicios.
$TF apply -target=google_cloud_run_v2_job.migrar -target=google_cloud_run_v2_job.esquemas -target=google_compute_instance.kafka -target=google_sql_database.base
for j in afiliacion autorizaciones premium custodia interoperabilidad; do
  gcloud run jobs execute "mcs-migrar-$j" --project "$P" --region "$R" --wait
done
sleep 60 # arranque de Kafka y Schema Registry en la VM
gcloud run jobs execute mcs-esquemas --project "$P" --region "$R" --wait
$TF apply
$TF output urls
