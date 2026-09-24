import { UserManager, WebStorageStateStore } from 'oidc-client-ts'

// Mismo cliente contra el emisor simulado o Keycloak (ADR-0014): solo cambia VITE_OIDC_AUTHORITY.
const aqui = `${window.location.origin}${import.meta.env.BASE_URL}`

export const sesion = new UserManager({
  authority: import.meta.env.VITE_OIDC_AUTHORITY || 'http://localhost:8081/realms/carpeta',
  client_id: 'portal',
  redirect_uri: aqui,
  post_logout_redirect_uri: aqui,
  scope: 'openid',
  ui_locales: 'es',
  userStore: new WebStorageStateStore({ store: window.sessionStorage }),
  automaticSilentRenew: false,
})
