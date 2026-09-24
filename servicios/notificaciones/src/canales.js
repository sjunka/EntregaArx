import nodemailer from 'nodemailer'

// Correo por SMTP (Mailpit en compose, el proveedor real en el objetivo).
export function crearCorreo({ url, remitente }) {
  const transporte = nodemailer.createTransport(url)
  return async ({ destino, asunto, texto }) => { await transporte.sendMail({ from: remitente, to: destino, subject: asunto, text: texto }) }
}

// B-06 análogo: no hay proveedor de SMS; el aviso se registra como enviado pero no sale a ninguna red.
export function crearSmsSimulado({ log }) {
  return async ({ destino, texto }) => {
    log('info', 'SMS simulado', { destino: `${destino.slice(0, 3)}***${destino.slice(-4)}`, caracteres: texto.length })
    return { detalle: 'SMS simulado: no hay proveedor real.' }
  }
}
