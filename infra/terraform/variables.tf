variable "project_id" {
  description = "ID del proyecto GCP nuevo (ADR-0015)."
  type        = string
}

variable "billing_account" {
  description = "Cuenta de facturación que se enlaza al proyecto."
  type        = string
}

variable "org_id" {
  description = "Organización o carpeta padre; vacío si la cuenta no tiene."
  type        = string
  default     = ""
}

variable "region" {
  type    = string
  default = "us-east1"
}

variable "atlas_project_id" {
  description = "ID del proyecto de MongoDB Atlas donde se crea el clúster M0."
  type        = string
}

variable "spa_url" {
  description = "URL de la SPA en GitHub Pages, sin barra final (AD-11)."
  type        = string
}

variable "imagen_tag" {
  description = "Etiqueta de las imágenes que sube infra/gcp/build.sh."
  type        = string
  default     = "latest"
}

variable "govcarpeta_url" {
  type    = string
  default = "https://govcarpeta-apis-4905ff3c005b.herokuapp.com"
}

variable "operador_id" {
  description = "ID de este operador ante GovCarpeta."
  type        = string
  default     = "6aa8afa3bcc6df0002eb66e5" # id de Mi Carpeta Segura en GovCarpeta (getOperators)
}

variable "smtp_url" {
  description = "Servidor SMTP real para correos (HU-08); vacío deja los correos sin enviar."
  type        = string
  default     = ""
  sensitive   = true
}
