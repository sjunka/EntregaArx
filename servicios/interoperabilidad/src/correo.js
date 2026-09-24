import nodemailer from 'nodemailer'

// Correo por SMTP (Mailpit en compose, el proveedor real en el objetivo). El archivo nunca va adjunto (B-14): solo enlaces.
// Plazos: un SMTP que no responde no debe colgar la solicitud del ciudadano. Nodemailer cierra la conexión a los 5 s sin saludo
// (así no queda un envío zombi que llegue después del reintento) y el plazo duro es la última red; el envío queda pendiente
// y el ciclo de reintentos lo retoma.
export function crearCorreo({ url, remitente, plazoMs = 15_000 }) {
  // La URL se descompone a mano: con la opción `url` nodemailer ignora los plazos.
  const u = new URL(url)
  const transporte = nodemailer.createTransport({
    host: u.hostname, port: Number(u.port) || (u.protocol === 'smtps:' ? 465 : 25), secure: u.protocol === 'smtps:',
    ...(u.username && { auth: { user: decodeURIComponent(u.username), pass: decodeURIComponent(u.password) } }),
    dnsTimeout: 5000, connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: plazoMs,
  })
  return {
    async enviar({ destino, asunto, texto }) {
      let plazo
      try {
        await Promise.race([
          transporte.sendMail({ from: remitente, to: destino, subject: asunto, text: texto }),
          new Promise((_, no) => { plazo = setTimeout(() => no(new Error('El servidor de correo no respondió a tiempo.')), plazoMs) }),
        ])
      } finally {
        clearTimeout(plazo)
      }
    },
  }
}
