# Kafka KRaft y Schema Registry en una sola VM e2-small (ADR-0015). Sin IP pública: solo la alcanza Cloud Run por la red.
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
  boot_disk {
    initialize_params {
      image = "cos-cloud/cos-stable"
      size  = 20
    }
  }
  network_interface {
    subnetwork = google_compute_subnetwork.mcs.id
    network_ip = google_compute_address.kafka.address
  }
  metadata = {
    user-data = templatefile("${path.module}/kafka-cloud-init.yaml.tftpl", { ip = google_compute_address.kafka.address })
  }
  allow_stopping_for_update = true
  depends_on                = [google_project_service.api]
}
