# DESIGN.md — Carpeta Ciudadana

## 1. Visual Theme & Atmosphere

### Producto

**Carpeta Ciudadana** es un operador de una infraestructura nacional de documentos digitales. La interfaz debe transmitir tres ideas en el primer vistazo:

1. **Esto es mío:** el ciudadano tiene control sobre su carpeta y decide qué documento sale.
2. **Esto es seguro:** los documentos están protegidos, las autorizaciones son explícitas y las acciones importantes dejan evidencia.
3. **Esto es sencillo:** el ciudadano no necesita entender la arquitectura distribuida para usar el servicio.

### Dirección visual

Usar una estética de **servicio público digital premium**: limpia, tranquila, confiable y altamente legible.

La referencia conceptual combina:
- el **minimalismo cálido y estructurado de Notion** para organización y sensación de espacio;
- la **claridad editorial de Mintlify** para lectura, jerarquía y densidad controlada;
- la **precisión funcional de Linear** para estados, tablas y acciones del sistema.

No copiar identidades de marca ni estilos literalmente. Crear una identidad propia para Carpeta Ciudadana.

### Sensación objetivo

- Confianza sin rigidez institucional.
- Tecnología avanzada sin apariencia de "software para ingenieros".
- Mucho espacio visual, pero sin desperdiciar pantalla en vistas operativas.
- Bordes suaves, superficies claras y contrastes sobrios.
- Microinteracciones discretas: la interfaz debe sentirse estable, no juguetona.

### Densidad

- **Ciudadano:** densidad baja-media; una decisión principal por zona.
- **Solicitudes/autorizaciones:** densidad media; comparar documentos rápidamente debe ser posible.
- **Administrador:** densidad media-alta; tablas y trazabilidad son válidas cuando aportan información.

### Regla principal

> La interfaz siempre debe explicar qué está pasando, qué puede hacer el usuario y qué efecto tendrá su acción.

Nunca usar una pantalla donde seguridad, estado o autorización dependan únicamente del color o de un icono ambiguo.

---

## 2. Color Palette & Roles

La paleta usa neutros cálidos/fríos muy claros con un **verde institucional propio** como color de confianza y acción primaria. Los estados semánticos se reservan para comunicar información operativa.

### Core palette

| Token | Hex | Rol |
|---|---|---|
| `ink-950` | `#17201C` | Texto principal, títulos críticos |
| `ink-700` | `#46514C` | Texto secundario |
| `ink-500` | `#6E7974` | Texto auxiliar, metadata |
| `surface-0` | `#FFFFFF` | Fondo de contenido principal |
| `surface-50` | `#F7F8F6` | Fondo general |
| `surface-100` | `#EEF1EE` | Secciones, fondos sutiles |
| `surface-200` | `#E0E5E1` | Bordes y divisores |
| `brand-700` | `#176B53` | Acción primaria, enlaces importantes |
| `brand-600` | `#218161` | Hover/énfasis |
| `brand-100` | `#DCEFE8` | Fondo de confianza/estado aprobado |
| `brand-50` | `#EFF8F4` | Superficie tenue para bloques de confianza |

### Semantic palette

| Token | Hex | Rol |
|---|---|---|
| `success-700` | `#216A45` | Acción completada, documento verificado |
| `success-50` | `#EDF7F1` | Fondo de éxito |
| `warning-700` | `#895B13` | Pendiente, requiere atención |
| `warning-50` | `#FFF7E8` | Fondo de advertencia |
| `danger-700` | `#B43B37` | Rechazo, revocación, fallo |
| `danger-50` | `#FDEEEE` | Fondo de error |
| `info-700` | `#245C83` | Información contextual |
| `info-50` | `#EEF6FC` | Fondo informativo |

### Uso del color

- El verde es el **color de acción y confianza**, no un adorno decorativo.
- `danger` aparece solamente cuando existe una consecuencia real: rechazar, revocar, borrar, bloquear o error.
- `warning` comunica pendiente o información que merece revisión.
- Nunca usar verde/rojo como único indicador de estado. Acompañar con texto e iconografía.
- Evitar gradientes fuertes, fondos saturados y colores neón.
- No utilizar el color de marca en grandes superficies si reduce contraste o hace que la interfaz parezca promocional.

### Tema claro y oscuro

La interfaz ofrece un conmutador explícito de tema, además de respetar la preferencia del
sistema mientras el usuario no elija. La elección se recuerda entre visitas.

- El tema no cambia el significado de un color: `danger` sigue siendo `danger` en ambos temas.
- Cada par texto/fondo cumple AA en los **dos** temas, no solo en el claro.
- Los diagramas heredan los mismos tokens que la interfaz. Un diagrama legible en claro y
  gris sobre gris en oscuro es un fallo, no un detalle estético.
- Un color de relleno de marca no sirve como color de texto sobre ese mismo relleno al
  invertir el tema: se reserva un token de "texto sobre acento" por tema.

### Contraste

Todo texto, controles y estados deben diseñarse para cumplir **WCAG 2.1 AA**. Priorizar contraste, foco visible y legibilidad sobre fidelidad estética.

---

## 3. Typography Rules

### Tipografía

Usar **Inter** como familia principal si está disponible. Si no, utilizar un sans-serif del sistema con métricas similares.

Los títulos no requieren serif. La identidad debe sentirse institucional y moderna mediante proporción, espacio y jerarquía, no mediante una tipografía ornamental.

### Escala

| Token | Tamaño | Peso | Uso |
|---|---:|---:|---|
| `display` | 40 px / 48 px | 700 | Hero excepcional, bienvenida |
| `h1` | 32 px / 40 px | 700 | Títulos de página |
| `h2` | 24 px / 32 px | 700 | Secciones |
| `h3` | 19 px / 28 px | 650 | Sub-secciones, tarjetas importantes |
| `body-lg` | 18 px / 28 px | 400 | Introducciones, mensajes guía |
| `body` | 16 px / 24 px | 400 | Texto principal |
| `body-medium` | 16 px / 24 px | 600 | Labels y énfasis |
| `small` | 14 px / 20 px | 400 | Ayuda, metadata |
| `caption` | 12 px / 16 px | 600 | Etiquetas técnicas o auxiliares |

### Reglas

- Mantener `body` en 16 px como tamaño base.
- Evitar párrafos largos sin subdivisión.
- Usar frases simples y verbos directos: **“Autorizar”**, **“Rechazar”**, **“Descargar”**, **“Compartir”**.
- No esconder información crítica en texto pequeño.
- Para estados legales o de seguridad, mostrar primero el significado y después el detalle técnico.
- Nunca comunicar una acción crítica únicamente con un icono.

### Voz de interfaz

Hablar como un servicio que guía, no como un sistema que ordena.

Preferir:
- “Tienes una solicitud pendiente.”
- “Elige los documentos que quieres compartir.”
- “Este documento tiene una firma verificable.”

Evitar:
- “Error de autorización.” cuando se puede explicar qué ocurrió.
- “Submit”, “Payload”, “Endpoint”, “Token”, “ObjectId” u otros términos de implementación en la interfaz ciudadana.

---

## Iconography

Use Lucide Icons as the single icon library.

Rules:
- Never use emojis as UI icons.
- Never mix multiple icon libraries.
- Use 20px icons for standard interface actions.
- Use 24px icons for primary navigation and prominent states.
- Default stroke width: 1.75–2px.
- Icons must always have semantic meaning.
- Use icons together with text for critical actions.
- Do not rely on color alone to communicate status.
- Maintain consistent alignment and optical weight.

### Implementación

```sh
npm install lucide-react
```

```jsx
import { ShieldCheck } from 'lucide-react'

<ShieldCheck size={20} strokeWidth={1.75} aria-hidden="true" />
```

El icono es decorativo cuando va acompañado de texto: lleva `aria-hidden="true"` y el
texto es quien nombra la acción. Cuando el control es solo icono, el botón lleva
`aria-label` con el mismo verbo que usaría la etiqueta visible.

El color del trazo sale siempre de un token (`currentColor` por defecto). No se pinta
un icono con un hex directo.

---

## 4. Component Styling

### Buttons

#### Primary

Usado para la **única acción principal** del contexto.

- Fondo: `brand-700`.
- Texto: blanco.
- Altura mínima: 44 px; preferir 48 px en flujos móviles.
- Radio: 10 px.
- Peso: 600.
- Hover: `brand-600`.
- Focus: anillo visible de 2–3 px.
- Disabled: fondo neutro y texto de contraste suficiente.

Ejemplos: `Autorizar`, `Compartir documentos`, `Continuar`.

#### Secondary

- Fondo transparente o `surface-0`.
- Borde `surface-200`.
- Texto `ink-950`.
- Radio 10 px.

Ejemplos: `Ver detalles`, `Cancelar`, `Volver`.

#### Destructive

Usar solo para rechazo, revocación o eliminación.

- Fondo preferente blanco/neutral con borde/texto `danger-700`.
- Cuando la acción exige confirmación, explicar la consecuencia en el modal antes de ejecutar.

### Cards

Las tarjetas son el principal contenedor de información del ciudadano.

- Fondo: `surface-0`.
- Borde de 1 px `surface-200`.
- Radio: 14 px.
- Padding: 20–24 px.
- Sombra mínima o inexistente en estado normal.
- Hover: cambio muy leve de borde/superficie, nunca elevación exagerada.

Usos:
- Resumen de carpeta.
- Documento individual.
- Solicitud de documentos.
- Estado de transferencia.
- Seguridad y cuenta.

### Document card

Cada documento debe mostrar claramente:

1. nombre del documento;
2. entidad emisora;
3. fecha;
4. estado de firma/verificación;
5. acción principal;
6. menú secundario para opciones adicionales.

No esconder la diferencia entre **documento oficial firmado** y **documento temporal no firmado**.

### Status badge

Los estados se representan con **texto + icono + color semántico**.

Estados recomendados:
- `Verificado`
- `Pendiente`
- `Requiere atención`
- `Rechazado`
- `Revocado`
- `Transferido`
- `Temporal / sin firma`

### Inputs

- Altura: 44–48 px.
- Borde 1 px `surface-200`.
- Radio 10 px.
- Label siempre visible; no depender solo de placeholder.
- Error mostrado debajo del campo con lenguaje humano y acción concreta.
- En campos sensibles, explicar por qué se necesita el dato cuando sea relevante.

### Navigation

Desktop:
- Sidebar izquierda, ancho aproximado 240–260 px.
- Logo/nombre arriba.
- Secciones claras y cortas.
- Perfil/seguridad al final.

Mobile:
- No convertir el sidebar en una navegación lateral estrecha.
- Usar navegación compacta y acciones prioritarias visibles.
- Mantener siempre accesibles: carpeta, solicitudes y perfil/seguridad.

### Modal / confirmation

Las acciones sensibles deben mostrar:
- qué se va a hacer;
- qué documentos están incluidos;
- quién recibirá la información;
- por cuánto tiempo o bajo qué contexto, cuando aplique;
- qué ocurrirá después.

Para autorizar una compartición, el botón debe decir **qué se autoriza**, no simplemente “Aceptar”.

### Toasts / banners

Usar toast para éxito simple y no crítico.

Usar banner o bloque persistente cuando el usuario deba tomar una decisión o exista una consecuencia relevante.

### Loading / empty states

Los estados vacíos nunca deben parecer un error.

Ejemplos:
- “Todavía no tienes documentos.”
- “No tienes solicitudes pendientes.”
- “Esta sección aparecerá cuando recibas tu primer documento.”

---

## 5. Layout Principles

### Grid

- Max-width de contenido: **1200–1280 px**.
- Columna principal cómoda para lectura: **720–840 px**.
- Gutter desktop: 24–32 px.
- Gutter mobile: 16 px.

### Spacing scale

Usar una escala basada en 4 px:

`4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48 / 64 / 80`

### Page structure

Cada página debe tener, en este orden cuando corresponda:

1. Título claro.
2. Contexto breve.
3. Estado o tarea pendiente más importante.
4. Contenido principal.
5. Ayuda o información secundaria.

### Home / Dashboard del ciudadano

El dashboard no debe parecer un panel de analítica. Debe parecer una **puerta de entrada a la carpeta**.

Orden recomendado:

1. saludo/contexto;
2. alertas o solicitudes que requieren acción;
3. resumen de documentos;
4. últimos documentos recibidos;
5. accesos rápidos;
6. seguridad/actividad reciente cuando sea útil.

### Information hierarchy

En cualquier vista, el usuario debe poder identificar en menos de unos segundos:
- dónde está;
- qué está pendiente;
- cuál es la acción principal;
- qué información es sensible o irreversible.

### Whitespace

Usar espacio para separar conceptos, no para decorar.

Evitar:
- bloques enormes de color;
- más de una acción primaria compitiendo en la misma sección;
- tarjetas sin función;
- dashboards con métricas irrelevantes para el ciudadano.

---

## 6. Depth & Elevation

La interfaz debe apoyarse principalmente en **bordes, superficies y separación espacial**, no en sombras fuertes.

### Elevation tokens

| Token | Uso |
|---|---|
| `elevation-0` | Contenido normal |
| `elevation-1` | Tarjetas flotantes, dropdowns |
| `elevation-2` | Modal, picker, panel temporal |
| `elevation-3` | Situaciones excepcionales; evitar en vistas normales |

### Shadow philosophy

- Sombras suaves y amplias.
- Ningún elemento debe parecer físicamente elevado muchos centímetros.
- Un modal debe distinguirse claramente del fondo, pero sin aspecto de popup publicitario.

### Borders

- 1 px, neutro y de bajo contraste.
- Usar el borde para agrupar y la sombra para establecer capas, no al revés.

---

## 7. Do's and Don'ts

### Do

- Diseñar primero el flujo crítico de **autorizar una solicitud**.
- Mostrar claramente qué documentos se van a compartir.
- Mostrar la entidad que solicita y el contexto de la solicitud.
- Diferenciar documentos verificados de temporales.
- Usar lenguaje no técnico para ciudadanos.
- Hacer visibles los estados de transferencia y recepción.
- Mantener una jerarquía visual estable en todas las pantallas.
- Diseñar primero mobile y después ampliar a desktop.
- Proveer foco de teclado visible y targets táctiles amplios.
- Mantener la misma terminología en navegación, botones, notificaciones y mensajes.

### Don't

- No convertir el producto en un dashboard de infraestructura.
- No usar estética de crypto/fintech para un producto público.
- No usar verde para todo: el color debe tener significado.
- No crear modales innecesarios para tareas normales.
- No esconder el receptor de una transferencia detrás de texto secundario.
- No pedir al ciudadano que interprete códigos técnicos para comprender un error.
- No usar un spinner indefinido durante transferencias largas; mostrar estado y progreso.
- No utilizar iconos como sustitutos de texto en acciones críticas.
- No crear formularios de alta densidad cuando un asistente paso a paso resuelva mejor el flujo.
- No diseñar pantallas separadas para cada excepción si un componente de estado puede resolverlas de forma consistente.

---

## 8. Responsive Behavior

El producto debe ser **responsive desde el inicio** y funcionar en dispositivos de gama baja.

### Breakpoints

Usar breakpoints por necesidad de layout, no por modelo de dispositivo:

- `sm`: 640 px
- `md`: 768 px
- `lg`: 1024 px
- `xl`: 1280 px

### Mobile rules

- Padding lateral: 16 px.
- Targets táctiles: mínimo 44 × 44 px.
- Botones primarios: ancho completo cuando simplifique la tarea.
- Tablas complejas: convertir en cards o filas expandibles.
- Sidebar: sustituir por navegación compacta.
- Formularios: una columna por defecto.
- Mantener visible el resumen de la acción antes de confirmar.

### Desktop rules

- Mantener el contenido centrado.
- Usar dos columnas solo cuando la segunda aporte contexto útil.
- En solicitudes de documentos, permitir revisión lateral o resumen persistente si no reduce claridad.

### Low bandwidth / low-end devices

- Evitar animaciones pesadas.
- No depender de imágenes para explicar estados.
- Priorizar contenido HTML estructurado.
- Mostrar estados de carga parciales y progresivos.
- Evitar polling agresivo desde la interfaz.

### Accessibility

Cumplir **WCAG 2.1 AA** como criterio de diseño, no como revisión final.

Requisitos visuales y de interacción:
- contraste suficiente;
- foco visible;
- navegación por teclado;
- labels asociados a inputs;
- mensajes de error asociados al control;
- orden de lectura correcto;
- no depender solo de color;
- soporte para zoom y tamaños de texto mayores;
- componentes compatibles con lectores de pantalla.

---

## 9. Product-specific UX Patterns

### A. Autorización de documentos — flujo más importante

La autorización es el corazón de la experiencia porque convierte la arquitectura de privacidad en una acción entendible.

#### Pantalla

**Título:** `Una entidad solicita documentos`

Mostrar inmediatamente:
- entidad solicitante;
- propósito/contexto;
- fecha de solicitud;
- lista de documentos;
- estado de cada documento;
- acción `Autorizar documentos`;
- acción secundaria `Rechazar`.

#### Antes de confirmar

Mostrar un resumen:

> “Vas a compartir 3 documentos con [entidad]. Esta acción quedará registrada.”

Cuando el caso lo requiera, el segundo factor aparece **después de la revisión**, no antes de mostrar al usuario qué está autorizando.

### B. Document detail

La vista de un documento debe responder:

- ¿Qué es?
- ¿Quién lo emitió?
- ¿Cuándo?
- ¿Está firmado/verificado?
- ¿Puedo descargarlo?
- ¿Con quién lo he compartido?

Los detalles criptográficos o técnicos se muestran bajo una sección secundaria del tipo **“Ver información de verificación”**.

### C. Transferencia / mudanza de operador

La mudanza debe sentirse como un proceso controlado, no como una configuración técnica.

Mostrar:
- operador actual;
- nuevo operador;
- progreso;
- documentos o datos incluidos;
- confirmación final;
- resultado.

Estados:
`Preparando` → `Transfiriendo` → `Verificando` → `Completado` / `Requiere atención`.

Nunca indicar simplemente “processing”.

### D. Documento temporal

Un temporal debe tener una señalización inequívoca:

`Documento temporal · sin firma verificable`

Acciones:
- reemplazar;
- descargar;
- eliminar;
- solicitar versión oficial cuando exista ese flujo.

### E. Actividad y trazabilidad

La trazabilidad es importante, pero el ciudadano no necesita ver un log técnico.

Mostrar eventos como:
- “Documento recibido de Ministerio de Educación.”
- “Compartiste tu diploma con la Embajada.”
- “Solicitud rechazada.”

Cuando se abra el detalle, mostrar fecha, actor y acción con un lenguaje comprensible.

### F. Notificaciones

Prioridades:
1. solicitud que requiere autorización;
2. documento nuevo recibido;
3. transferencia o mudanza terminada;
4. evento de seguridad;
5. información general.

No bombardear al ciudadano con notificaciones para eventos técnicos internos.

---

## 10. Core Screens

### Ciudadano

1. **Inicio / Carpeta**
2. **Mis documentos**
3. **Detalle del documento**
4. **Solicitudes**
5. **Detalle de solicitud / autorización**
6. **Subir documento temporal**
7. **Compartir documentos**
8. **Transferir mi carpeta / Cambiar de operador**
9. **Notificaciones**
10. **Perfil y seguridad**

### Entidad

1. Buscar/seleccionar ciudadano según la experiencia permitida.
2. Crear solicitud de documentos.
3. Ver estado de la solicitud.
4. Recibir paquete autorizado.

### Administrador del operador

1. Salud del operador.
2. Transferencias.
3. Integraciones.
4. Auditoría.
5. Usuarios y permisos.
6. Incidencias.

El administrador puede tener una UI más densa, pero debe reutilizar los mismos tokens, componentes y estados.

---

## 11. Design Tokens — Implementation Starter

```css
:root {
  --color-ink-950: #17201C;
  --color-ink-700: #46514C;
  --color-ink-500: #6E7974;

  --color-surface-0: #FFFFFF;
  --color-surface-50: #F7F8F6;
  --color-surface-100: #EEF1EE;
  --color-surface-200: #E0E5E1;

  --color-brand-700: #176B53;
  --color-brand-600: #218161;
  --color-brand-100: #DCEFE8;
  --color-brand-50: #EFF8F4;

  --color-success-700: #216A45;
  --color-success-50: #EDF7F1;
  --color-warning-700: #895B13;
  --color-warning-50: #FFF7E8;
  --color-danger-700: #B43B37;
  --color-danger-50: #FDEEEE;
  --color-info-700: #245C83;
  --color-info-50: #EEF6FC;

  --radius-sm: 8px;
  --radius-md: 10px;
  --radius-lg: 14px;
  --radius-xl: 18px;

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;
  --space-12: 48px;
  --space-16: 64px;

  --shadow-1: 0 2px 10px rgba(23, 32, 28, 0.05);
  --shadow-2: 0 12px 32px rgba(23, 32, 28, 0.10);
}
```

---

## 12. Agent Prompt Guide

When an AI coding/design agent generates a new screen for this project, it should follow these rules:

> Build the UI as a calm, trustworthy Colombian public digital service. Use a warm-neutral surface system with a restrained institutional green as the primary action color. Use Inter/system sans-serif, 16 px body text, rounded 10–14 px controls/cards, subtle borders, minimal shadows and generous spacing. Prioritize clarity over decoration. Every critical citizen action must state its consequence in plain language. Never expose implementation jargon such as API, endpoint, ObjectId, payload or token in the citizen-facing interface. Distinguish verified official documents from temporary unsigned documents. Use text + icon + color for statuses. Make the critical authorization flow understandable in no more than a few deliberate steps, with the requestor, purpose, selected documents and final action visible before confirmation. Design mobile-first, WCAG 2.1 AA, keyboard accessible, touch-friendly and usable on low-end devices. Keep dashboards calm and task-oriented; do not imitate crypto, trading, gaming or developer-tool aesthetics.

### Preferred component vocabulary

`PageHeader`, `Sidebar`, `BottomNav`, `DocumentCard`, `DocumentStatus`, `RequestCard`, `AuthorizationSummary`, `PrimaryButton`, `SecondaryButton`, `DangerButton`, `StepIndicator`, `Timeline`, `SecurityNotice`, `EmptyState`, `ErrorState`, `LoadingState`, `ConfirmationDialog`, `ActivityItem`, `Toast`.

### Preferred copy vocabulary

Use:
- Carpeta
- Documento
- Documento temporal
- Documento verificado
- Solicitud
- Autorizar
- Rechazar
- Compartir
- Recibir
- Transferir
- Operador
- Actividad
- Seguridad

Avoid:
- Dashboard (use `Inicio` when speaking to citizens)
- Payload
- Endpoint
- Token
- ObjectId
- Callback
- Webhook
- Job
- Queue
- Retry

---

## 13. Relationship to the Architecture

This DESIGN.md defines **visual and interaction language**, not the software architecture.

The UI should reflect the architecture's important boundaries without exposing implementation details:

- The centralizador is a **directory/identity dependency**, not a document store in the UI mental model.
- Documents move between operators; the user sees this as **recepción, transferencia o compartición**, not as internal messaging infrastructure.
- Authorization is explicit and auditable.
- Security and traceability must be visible as user outcomes, while cryptographic and integration details stay in secondary technical views.

### Architecture-aware UI states

The frontend must have explicit states for:
- request created;
- waiting for citizen authorization;
- second-factor verification;
- transfer in progress;
- transfer completed;
- transfer failed and recoverable;
- document received;
- signature verified;
- signature verification unavailable;
- temporary document uploaded;
- notification sent / pending.

Do not collapse these into a generic `loading` state.

---

## 14. Acceptance Checklist for New Screens

Before accepting a new screen, verify:

- [ ] The primary task is obvious without reading every word.
- [ ] The interface uses the established color tokens.
- [ ] Critical actions are at least 44 px high.
- [ ] Focus state is visible.
- [ ] Status is not communicated by color alone.
- [ ] Citizen-facing copy contains no implementation jargon.
- [ ] Official/verified vs temporary/unsigned documents are visually distinct.
- [ ] Sensitive actions explain their consequence before confirmation.
- [ ] Mobile layout is usable at narrow widths.
- [ ] Empty, loading, success and error states are explicitly designed.
- [ ] The screen remains understandable with increased text size.
- [ ] The design preserves the calm, trustworthy public-service aesthetic.

---

## Source-informed design rationale

This system is tailored to the project requirements rather than copied from a commercial product. The project describes six citizen-facing use cases and identifies usability, security, privacy, traceability, interoperability and accessibility as core concerns. The design therefore treats **authorization, document status, clarity of language and recovery/progress states** as first-class UI concepts.

The selected visual direction is intentionally a hybrid: Notion is useful for calm organization and soft surfaces, Mintlify for reading clarity, and Linear for precise operational states. These references are starting points only; the resulting tokens and components above are a custom system for Carpeta Ciudadana.
