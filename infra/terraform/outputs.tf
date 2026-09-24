output "urls" {
  description = "URL públicas para el smoke e2e y para las variables VITE_* de la SPA."
  value       = merge(local.url, { emisor = local.emisor })
}

output "usuario_demo_clave" {
  description = "Contraseña de las cuentas de demostración: terraform output -raw usuario_demo_clave"
  value       = random_password.secreto["usuario_demo"].result
  sensitive   = true
}
