output "urls" {
  description = "URL públicas para el smoke e2e y para las variables VITE_* de la SPA."
  value       = merge(local.url, { emisor = local.emisor })
}

output "usuario_demo_clave" {
  description = "Contraseña de las cuentas de demostración: terraform output -raw usuario_demo_clave"
  value       = random_password.secreto["usuario_demo"].result
  sensitive   = true
}

output "mailpit" {
  description = "Buzón de prueba del demo (ADR-0026): usuario demo y la clave de terraform output -raw mailpit_clave."
  value       = "http://${google_compute_instance.kafka.network_interface[0].access_config[0].nat_ip}:8025"
}

output "mailpit_clave" {
  value     = random_password.mailpit.result
  sensitive = true
}
