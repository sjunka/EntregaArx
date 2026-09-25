# Kafka KRaft y Schema Registry en una sola VM e2-small (ADR-0015). La IP externa solo sirve para bajar las imágenes de Docker Hub
# (evita un Cloud NAT). Desde fuera de la subred solo entra la página de Mailpit (ADR-0026), con usuario y clave.
resource "google_compute_address" "kafka" {
  name         = "mcs-kafka"
  region       = var.region
  subnetwork   = google_compute_subnetwork.mcs.id
  address_type = "INTERNAL"
}

resource "google_compute_instance" "kafka" {
  name         = "mcs-kafka"
  zone         = "${var.region}-b"
  machine_type = "e2-small"
  tags         = ["mailpit"]
  boot_disk {
    initialize_params {
      image = "cos-cloud/cos-stable"
      size  = 20
    }
  }
  network_interface {
    subnetwork = google_compute_subnetwork.mcs.id
    network_ip = google_compute_address.kafka.address
    access_config {}
  }
  metadata = {
    user-data = templatefile("${path.module}/kafka-cloud-init.yaml.tftpl", { ip = google_compute_address.kafka.address, mailpit_clave = random_password.mailpit.result })
  }
  allow_stopping_for_update = true
  depends_on                = [google_project_service.api]
}
