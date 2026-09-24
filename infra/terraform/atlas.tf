# MongoDB Atlas M0 (gratis) sobre GCP para MS-09, MS-05, MS-02 y MS-10.
resource "random_password" "mongo" {
  length  = 32
  special = false
}

resource "mongodbatlas_advanced_cluster" "mcs" {
  project_id   = var.atlas_project_id
  name         = "mcs"
  cluster_type = "REPLICASET"
  replication_specs {
    region_configs {
      provider_name         = "TENANT"
      backing_provider_name = "GCP"
      region_name           = "CENTRAL_US" # M0 solo existe en algunas regiones; la más cercana a us-east1.
      priority              = 7
      electable_specs {
        instance_size = "M0"
      }
    }
  }
}

resource "mongodbatlas_database_user" "mcs" {
  project_id         = var.atlas_project_id
  username           = "mcs"
  password           = random_password.mongo.result
  auth_database_name = "admin"
  roles {
    role_name     = "readWriteAnyDatabase"
    database_name = "admin"
  }
}

# ponytail: abierto a todo internet (Cloud Run no tiene IP fija en M0); la clave es la única barrera. Cerrar con NAT y IP fija si sobrevive al curso.
resource "mongodbatlas_project_ip_access_list" "todo" {
  project_id = var.atlas_project_id
  cidr_block = "0.0.0.0/0"
  comment    = "Cloud Run sin IP fija"
}

locals {
  mongo_host = replace(mongodbatlas_advanced_cluster.mcs.connection_strings[0].standard_srv, "mongodb+srv://", "")
  mongo_url  = "mongodb+srv://mcs:${random_password.mongo.result}@${local.mongo_host}/?retryWrites=true&w=majority"
}
