terraform {
  required_version = ">= 1.9"
  required_providers {
    google       = { source = "hashicorp/google", version = "~> 6.0" }
    random       = { source = "hashicorp/random", version = "~> 3.6" }
    tls          = { source = "hashicorp/tls", version = "~> 4.0" }
    mongodbatlas = { source = "mongodb/mongodbatlas", version = "~> 1.21" }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# Las llaves de Atlas llegan por MONGODB_ATLAS_PUBLIC_KEY y MONGODB_ATLAS_PRIVATE_KEY, nunca por el repo.
provider "mongodbatlas" {}

# La API de presupuestos exige un proyecto de cuota cuando se usan credenciales de usuario.
provider "google" {
  alias                 = "facturacion"
  project               = var.project_id
  billing_project       = var.project_id
  user_project_override = true
}
