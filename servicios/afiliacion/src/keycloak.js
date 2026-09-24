// Admin API de Keycloak con client credentials (cliente afiliacion-admin, rol manage-users).
export function crearKeycloak({ url, realm, clientId, clientSecret, fetch = globalThis.fetch }) {
  const admin = `${url}/admin/realms/${realm}`

  async function token() {
    const r = await fetch(`${url}/realms/${realm}/protocol/openid-connect/token`, {
      method: 'POST',
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
    })
    if (!r.ok) throw new Error(`Keycloak token ${r.status}`)
    return (await r.json()).access_token
  }

  async function llamar(metodo, ruta, cuerpo) {
    const r = await fetch(admin + ruta, {
      method: metodo,
      headers: { authorization: `Bearer ${await token()}`, 'content-type': 'application/json' },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    })
    return r
  }

  return {
    // { id, cedula, habilitado } o null si la cuenta no existe.
    async buscar(username) {
      const r = await llamar('GET', `/users?exact=true&username=${encodeURIComponent(username)}`)
      if (!r.ok) throw new Error(`Keycloak buscar usuario ${r.status}`)
      const [u] = await r.json()
      return u ? { id: u.id, cedula: u.attributes?.cedula?.[0] ?? null, habilitado: u.enabled } : null
    },
    async crearDeshabilitado({ cuenta, nombre, apellido, correoContacto, telefono, cedula, clave }) {
      const r = await llamar('POST', '/users', {
        username: cuenta, email: cuenta, emailVerified: true, firstName: nombre, lastName: apellido,
        enabled: false, attributes: { cedula: [cedula], correoContacto: [correoContacto], telefono: [telefono] },
        credentials: [{ type: 'password', value: clave, temporary: false }],
      })
      if (r.status !== 201) throw new Error(`Keycloak crear usuario ${r.status}: ${await r.text()}`)
      return r.headers.get('location').split('/').pop()
    },
    async habilitar(id) {
      const r = await llamar('PUT', `/users/${id}`, { enabled: true })
      if (!r.ok) throw new Error(`Keycloak habilitar ${r.status}`)
    },
    // HU-09: el ciudadano trasladado fija su clave con el enlace de activación (reset-password, no temporal).
    async fijarClave(id, clave) {
      const r = await llamar('PUT', `/users/${id}/reset-password`, { type: 'password', value: clave, temporary: false })
      if (!r.ok) throw new Error(`Keycloak reset-password ${r.status}`)
    },
    async borrar(id) {
      const r = await llamar('DELETE', `/users/${id}`)
      if (!r.ok && r.status !== 404) throw new Error(`Keycloak borrar ${r.status}`)
    },
  }
}
