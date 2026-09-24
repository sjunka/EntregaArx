locals {
  numero     = google_project.mcs.number
  nombres    = ["pasarela", "afiliacion", "autorizaciones", "premium", "custodia", "interoperabilidad", "notificaciones", "indice", "auditoria", "analitica"]
  url        = { for n in concat(local.nombres, ["keycloak"]) : n => "https://mcs-${n}-${local.numero}.${var.region}.run.app" }
  emisor     = "${local.url.keycloak}/realms/carpeta"
  spa_origen = regex("^https?://[^/]+", var.spa_url)
  kafka      = "${google_compute_address.kafka.address}:9092"
  registro_e = "http://${google_compute_address.kafka.address}:8081"

  # Variables comunes de los servicios que validan el token del emisor (ADR-0014: solo cambian estas).
  oidc = {
    OIDC_ISSUER   = local.emisor
    OIDC_JWKS_URL = "${local.emisor}/protocol/openid-connect/certs"
    ORIGENES      = local.spa_origen
  }
  bus = { KAFKA_BROKERS = local.kafka, SCHEMA_REGISTRY_URL = local.registro_e }

  # env: valores planos. sec: variable => secreto de Secret Manager. bus: consume o publica eventos (necesita CPU siempre asignada).
  svc = {
    pasarela = {
      env = { GOVCARPETA_URL = var.govcarpeta_url, GOVCARPETA_ESCRITURA = "0", OPERADOR_ID = var.operador_id, OPERADOR_NOMBRE = "Mi Carpeta Segura" }
      sec = {}
    }
    afiliacion = {
      bus = true, migra = true
      env = merge(local.oidc, local.bus, { PASARELA_URL = local.url.pasarela, KEYCLOAK_URL = local.url.keycloak, KEYCLOAK_REALM = "carpeta", KEYCLOAK_CLIENTE = "afiliacion-admin", OPERADOR_NOMBRE = "Mi Carpeta Segura", CONFIAR_PROXY = "1" })
      sec = { DATABASE_URL = "url_afiliacion", KEYCLOAK_SECRETO = "kc_afiliacion", ACTIVACION_SECRETO = "activacion" }
    }
    autorizaciones = {
      migra = true
      env   = merge(local.oidc, {})
      sec   = { DATABASE_URL = "url_autorizaciones" }
    }
    premium = {
      migra = true
      env   = merge(local.oidc, { AUTORIZACIONES_URL = local.url.autorizaciones, OIDC_INTERNO_URL = local.emisor })
      sec   = { DATABASE_URL = "url_premium", KC_PREMIUM_SECRETO = "kc_premium" }
    }
    custodia = {
      bus = true, migra = true
      env = merge(local.oidc, local.bus, {
        PASARELA_URL = local.url.pasarela, AUTORIZACIONES_URL = local.url.autorizaciones, OIDC_INTERNO_URL = local.emisor,
        S3_ENDPOINT  = "https://storage.googleapis.com", S3_ENDPOINT_PUBLICO = "https://storage.googleapis.com", S3_REGION = "auto",
        S3_BUCKET    = google_storage_bucket.binarios["documentos"].name, S3_BUCKET_CERTIFICADOS = google_storage_bucket.binarios["certificados"].name,
      })
      sec = { DATABASE_URL = "url_custodia", KC_CUSTODIA_SECRETO = "kc_custodia", S3_ACCESS_KEY = "s3_acceso", S3_SECRET_KEY = "s3_secreto" }
    }
    interoperabilidad = {
      bus = true, migra = true
      env = merge(local.oidc, local.bus, {
        PASARELA_URL = local.url.pasarela, CUSTODIA_URL = local.url.custodia, AUTORIZACIONES_URL = local.url.autorizaciones, AFILIACION_URL = local.url.afiliacion,
        SPA_URL      = var.spa_url, URL_PUBLICA = local.url.interoperabilidad, ENLACES_URL = local.url.interoperabilidad, OIDC_INTERNO_URL = local.emisor, OPERADOR_NOMBRE = "Mi Carpeta Segura",
      })
      sec = { DATABASE_URL = "url_interoperabilidad", KC_INTEROP_SECRETO = "kc_interop", ENLACE_SECRETO = "enlace", SMTP_URL = "smtp_url" }
    }
    notificaciones = { bus = true, env = merge(local.oidc, local.bus), sec = { MONGO_URL = "mongo_url", SMTP_URL = "smtp_url" } }
    indice         = { bus = true, env = merge(local.oidc, local.bus), sec = { MONGO_URL = "mongo_url" } }
    auditoria      = { bus = true, env = merge(local.oidc, local.bus), sec = { MONGO_URL = "mongo_url" } }
    analitica      = { bus = true, env = merge(local.oidc, local.bus, { REGIONES_EMISORES = "universidad-demo=Bogotá D.C." }), sec = { MONGO_URL = "mongo_url", ANALITICA_SAL = "analitica_sal" } }
  }

  imagen = { for n in concat(local.nombres, ["keycloak", "esquemas"]) : n => "${local.registro}/${n}:${var.imagen_tag}" }
  migra  = [for n, s in local.svc : n if try(s.migra, false)]

  vpc = { network = google_compute_network.mcs.id, subnetwork = google_compute_subnetwork.mcs.id }
}

resource "google_cloud_run_v2_service" "svc" {
  for_each            = local.svc
  name                = "mcs-${each.key}"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = false
  template {
    service_account = google_service_account.run.email
    scaling {
      min_instance_count = try(each.value.bus, false) ? 1 : 0
      max_instance_count = 2
    }
    vpc_access {
      egress = "PRIVATE_RANGES_ONLY"
      network_interfaces {
        network    = local.vpc.network
        subnetwork = local.vpc.subnetwork
      }
    }
    containers {
      image = local.imagen[each.key]
      resources {
        limits   = { cpu = "1", memory = "512Mi" }
        cpu_idle = !try(each.value.bus, false) # los consumidores de Kafka y la bandeja de salida corren fuera de una petición
      }
      dynamic "env" {
        for_each = each.value.env
        content {
          name  = env.key
          value = env.value
        }
      }
      dynamic "env" {
        for_each = each.value.sec
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.s[env.value].secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }
  depends_on = [google_secret_manager_secret_version.s, google_project_iam_member.run, google_sql_database.base]
}

# Keycloak real (ADR-0014): mismo realm «carpeta», sus secretos y usuarios de demostración entran por el entorno.
resource "google_cloud_run_v2_service" "keycloak" {
  name                = "mcs-keycloak"
  location            = var.region
  deletion_protection = false
  template {
    service_account = google_service_account.run.email
    scaling {
      min_instance_count = 1
      max_instance_count = 1
    }
    vpc_access {
      egress = "PRIVATE_RANGES_ONLY"
      network_interfaces {
        network    = local.vpc.network
        subnetwork = local.vpc.subnetwork
      }
    }
    containers {
      image = local.imagen.keycloak
      ports { container_port = 8080 }
      resources {
        limits = { cpu = "1", memory = "1Gi" }
      }
      startup_probe {
        tcp_socket { port = 8080 }
        timeout_seconds   = 5
        period_seconds    = 10
        failure_threshold = 30
      }
      dynamic "env" {
        for_each = {
          KC_DB           = "postgres", KC_DB_URL = "jdbc:postgresql://${google_sql_database_instance.pg.private_ip_address}/keycloak", KC_DB_USERNAME = "mcs",
          KC_HTTP_ENABLED = "true", KC_PROXY_HEADERS = "xforwarded", KC_HOSTNAME = local.url.keycloak, KC_HEALTH_ENABLED = "true",
          SPA_URL         = var.spa_url, SPA_ORIGEN = local.spa_origen, KC_BOOTSTRAP_ADMIN_USERNAME = "admin",
        }
        content {
          name  = env.key
          value = env.value
        }
      }
      dynamic "env" {
        for_each = {
          KC_DB_PASSWORD        = "pg_clave", KC_BOOTSTRAP_ADMIN_PASSWORD = "kc_admin", USUARIO_DEMO_CLAVE = "usuario_demo",
          KC_AFILIACION_SECRETO = "kc_afiliacion", KC_INTEROP_SECRETO = "kc_interop", KC_CUSTODIA_SECRETO = "kc_custodia", KC_PREMIUM_SECRETO = "kc_premium",
        }
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.s[env.value].secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }
  depends_on = [google_secret_manager_secret_version.s, google_project_iam_member.run, google_sql_database.base]
}

resource "google_cloud_run_v2_service_iam_member" "publico" {
  for_each = toset(concat(local.nombres, ["keycloak"]))
  name     = each.key == "keycloak" ? google_cloud_run_v2_service.keycloak.name : google_cloud_run_v2_service.svc[each.key].name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# RD-10: las migraciones son un proceso aparte. `infra/gcp/desplegar.sh` las ejecuta antes de crear los servicios.
resource "google_cloud_run_v2_job" "migrar" {
  for_each            = toset(local.migra)
  name                = "mcs-migrar-${each.key}"
  location            = var.region
  deletion_protection = false
  template {
    template {
      service_account = google_service_account.run.email
      vpc_access {
        egress = "PRIVATE_RANGES_ONLY"
        network_interfaces {
          network    = local.vpc.network
          subnetwork = local.vpc.subnetwork
        }
      }
      containers {
        image   = local.imagen[each.key]
        command = ["node", "src/server.js", "--migrar"]
        env {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.s["url_${each.key}"].secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }
  depends_on = [google_secret_manager_secret_version.s, google_sql_database.base, google_sql_user.mcs, google_project_iam_member.run]
}

# Registra los esquemas de contratos/eventos en el Schema Registry de la VM.
resource "google_cloud_run_v2_job" "esquemas" {
  name                = "mcs-esquemas"
  location            = var.region
  deletion_protection = false
  template {
    template {
      service_account = google_service_account.run.email
      vpc_access {
        egress = "PRIVATE_RANGES_ONLY"
        network_interfaces {
          network    = local.vpc.network
          subnetwork = local.vpc.subnetwork
        }
      }
      containers {
        image = local.imagen.esquemas
        env {
          name  = "SCHEMA_REGISTRY_URL"
          value = local.registro_e
        }
      }
    }
  }
  depends_on = [google_project_iam_member.run]
}
