terraform {
  required_version = ">= 1.9"
  required_providers {
    google       = { source = "hashicorp/google", version = "~> 6.0" }
    random       = { source = "hashicorp/random", version = "~> 3.6" }
    mongodbatlas = { source = "mongodb/mongodbatlas", version = "~> 1.21" }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# Las llaves de Atlas llegan por MONGODB_ATLAS_PUBLIC_KEY y MONGODB_ATLAS_PRIVATE_KEY, nunca por el repo.
provider "mongodbatlas" {}
