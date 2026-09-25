# Alerta de gasto: avisa por correo a los administradores de facturación. No apaga nada.
resource "google_billing_budget" "mcs" {
  provider        = google.facturacion
  billing_account = var.billing_account
  display_name    = "Mi Carpeta Segura"

  budget_filter {
    projects = ["projects/${google_project.mcs.number}"]
  }

  amount {
    specified_amount {
      units = tostring(var.presupuesto_mensual)
    }
  }

  dynamic "threshold_rules" {
    for_each = [0.5, 0.9, 1.0]
    content {
      threshold_percent = threshold_rules.value
    }
  }

  depends_on = [google_project_service.api]
}
