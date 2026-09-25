# Despliegue único y económico (ADR-0015). `terraform destroy` lo elimina todo.
locals {
  aleatorios = ["kc_admin", "kc_afiliacion", "kc_interop", "kc_custodia", "kc_premium", "usuario_demo", "enlace", "activacion", "analitica_sal"]
  apis       = ["run", "sqladmin", "compute", "secretmanager", "artifactregistry", "cloudbuild", "storage", "iam", "servicenetworking"]
  bases      = ["afiliacion", "custodia", "interoperabilidad", "autorizaciones", "premium", "keycloak"] # RD-11: una por servicio
  buckets    = { documentos = "${var.project_id}-documentos", certificados = "${var.project_id}-certificados" }
  registro   = "${var.region}-docker.pkg.dev/${var.project_id}/mcs"
}

resource "google_project" "mcs" {
  name                = "Mi Carpeta Segura"
  project_id          = var.project_id
  billing_account     = var.billing_account
  org_id              = var.org_id == "" ? null : var.org_id
  auto_create_network = false
  deletion_policy     = "DELETE"
}

resource "google_project_service" "api" {
  for_each           = toset(local.apis)
  project            = google_project.mcs.project_id
  service            = "${each.key}.googleapis.com"
  disable_on_destroy = false
}

resource "google_artifact_registry_repository" "mcs" {
  repository_id = "mcs"
  format        = "DOCKER"
  location      = var.region
  depends_on    = [google_project_service.api]
}

# Red mínima: Cloud Run sale por Direct VPC egress hacia la VM de Kafka.
resource "google_compute_network" "mcs" {
  name                    = "mcs"
  auto_create_subnetworks = false
  depends_on              = [google_project_service.api]
}

resource "google_compute_subnetwork" "mcs" {
  name          = "mcs"
  region        = var.region
  network       = google_compute_network.mcs.id
  ip_cidr_range = "10.10.0.0/24"
}

resource "google_compute_firewall" "kafka" {
  name          = "mcs-kafka"
  network       = google_compute_network.mcs.name
  source_ranges = [google_compute_subnetwork.mcs.ip_cidr_range]
  allow {
    protocol = "tcp"
    ports    = ["9092", "8081", "1025"] # 1025: SMTP de Mailpit (ADR-0026)
  }
}

# ADR-0026: la página de Mailpit es pública para el demo, detrás de usuario y clave (terraform output mailpit).
resource "google_compute_firewall" "mailpit" {
  name          = "mcs-mailpit"
  network       = google_compute_network.mcs.name
  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["mailpit"]
  allow {
    protocol = "tcp"
    ports    = ["8025"]
  }
}

# IP privada para Cloud SQL: Cloud Run y Keycloak entran por la misma red que Kafka, sin proxy ni sockets.
resource "google_compute_global_address" "sql" {
  name          = "mcs-sql"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 24
  network       = google_compute_network.mcs.id
}

resource "google_service_networking_connection" "sql" {
  network                 = google_compute_network.mcs.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.sql.name]
  deletion_policy         = "ABANDON"
  depends_on              = [google_project_service.api]
}

# Cloud SQL mínimo: una instancia y una base por servicio.
resource "random_password" "sql" {
  length  = 32
  special = false
}

# Cloud SQL no deja reusar un nombre recién borrado durante días: el sufijo permite reintentar.
resource "random_id" "sql" {
  byte_length = 3
}

resource "google_sql_database_instance" "pg" {
  name                = "mcs-pg-${random_id.sql.hex}"
  region              = var.region
  database_version    = "POSTGRES_16"
  deletion_protection = false
  settings {
    tier              = "db-f1-micro"
    edition           = "ENTERPRISE"
    availability_type = "ZONAL"
    disk_size         = 10
    backup_configuration { enabled = false }
    ip_configuration {
      ipv4_enabled    = false
      private_network = google_compute_network.mcs.id
    }
  }
  depends_on = [google_service_networking_connection.sql]
}

resource "google_sql_database" "base" {
  for_each = toset(local.bases)
  name     = each.key
  instance = google_sql_database_instance.pg.name
}

resource "google_sql_user" "mcs" {
  name     = "mcs"
  instance = google_sql_database_instance.pg.name
  password = random_password.sql.result
}

# Binarios (RI-06): URL prefirmadas por la API S3 de GCS con llaves HMAC de una cuenta de servicio.
resource "google_storage_bucket" "binarios" {
  for_each                    = local.buckets
  name                        = each.value
  location                    = var.region
  force_destroy               = true
  uniform_bucket_level_access = true
  cors {
    origin          = [local.spa_origen]
    method          = ["GET", "PUT", "HEAD"]
    response_header = ["content-type", "content-md5", "x-goog-*"]
    max_age_seconds = 3600
  }
  depends_on = [google_project_service.api]
}

resource "google_service_account" "custodia_s3" {
  account_id = "custodia-s3"
  depends_on = [google_project_service.api]
}

resource "google_storage_bucket_iam_member" "custodia" {
  for_each = local.buckets
  bucket   = google_storage_bucket.binarios[each.key].name
  role     = "roles/storage.objectAdmin"
  member   = "serviceAccount:${google_service_account.custodia_s3.email}"
}

resource "google_storage_hmac_key" "custodia" {
  service_account_email = google_service_account.custodia_s3.email
}

# ADR-0026: llave fija de la universidad simulada, para que MS-07 no se quede con una pública vieja si el servicio reinicia.
resource "tls_private_key" "entidad" {
  algorithm = "RSA"
  rsa_bits  = 2048
}

resource "random_password" "mailpit" {
  length  = 24
  special = false
}

# Secretos: se generan aquí, viven en Secret Manager y en el estado (que no se versiona).
resource "random_password" "secreto" {
  for_each = toset(local.aleatorios)
  length   = 40
  special  = false
}

locals {
  secretos = merge(
    { for k in local.aleatorios : k => random_password.secreto[k].result },
    {
      pg_clave      = random_password.sql.result
      s3_acceso     = google_storage_hmac_key.custodia.access_id
      s3_secreto    = google_storage_hmac_key.custodia.secret
      mongo_url     = local.mongo_url
      smtp_url      = var.smtp_url == "" ? "smtp://${google_compute_address.kafka.address}:1025" : var.smtp_url # sin SMTP real, Mailpit de la VM
      entidad_llave = tls_private_key.entidad.private_key_pem_pkcs8
    },
    { for b in local.bases : "url_${b}" => "postgres://mcs:${random_password.sql.result}@${google_sql_database_instance.pg.private_ip_address}/${b}" },
  )
}

resource "google_secret_manager_secret" "s" {
  for_each  = local.secretos
  secret_id = replace(each.key, "_", "-")
  replication {
    auto {}
  }
  depends_on = [google_project_service.api]
}

resource "google_secret_manager_secret_version" "s" {
  for_each    = local.secretos
  secret      = google_secret_manager_secret.s[each.key].id
  secret_data = each.value
}

resource "google_service_account" "run" {
  account_id = "mcs-run"
  depends_on = [google_project_service.api]
}

resource "google_project_iam_member" "run" {
  for_each = toset(["roles/secretmanager.secretAccessor"])
  project  = var.project_id
  role     = each.key
  member   = "serviceAccount:${google_service_account.run.email}"
}
