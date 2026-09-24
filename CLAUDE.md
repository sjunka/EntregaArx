## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` plus `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Proyecto

Mi Carpeta Segura, operador de Carpeta Ciudadana. El diseño está aprobado y se implementa fielmente. Fuente: `/Users/sjunka/Documents/ArquitecturasAvanzadasDeSoftware/PROMPT-APP.md`, `entregas-md/` y `assignment{1,2}/diagramas/`. Si hay una contradicción o un hueco en el diseño, preguntar antes de decidir.

- Historias HU-01 a HU-13 en orden numérico. HU-01 a HU-04 se reconstruyen portando la lógica de `carpeta-ciudadana/operador/` (no se modifica ese repo).
- Ciclo por HU: contrato (OpenAPI 3.1 o CloudEvents) que valida, luego test que falla, implementación mínima, e2e Playwright + axe y trazabilidad RF/RNF/RI. Cerrar con commit `feat(HU-xx): ...` y push a `origin`.
- Stack: SPA en `web/` con Vite + React + Tailwind v4 (ADR-0013); servicios en `servicios/<ms>/` con Node 22 + Express 5; identidad con emisor simulado intercambiable con Keycloak (ADR-0014).
- Kafka, Schema Registry y MongoDB se agregan cuando una HU los pide, no antes.
- Despliegue en GCP solo al final (ADR-0015).

## Restricciones no negociables

- RD-02: servicios sin estado. RD-11: una base de datos por servicio, nunca compartida.
- RD-15 y RI-01: el contenido de los documentos nunca pasa por GovCarpeta. RI-06: los binarios viajan por URL prefirmada. RI-08: MS-06 decide antes de que MS-04 firme una URL de lectura.
- Errores `application/problem+json` (RFC 9457). Eventos CloudEvents 1.0.
- Un cambio de stack o de estilo exige un ADR nuevo, aprobado antes de hacerlo.
- Nunca escribir en GovCarpeta (`GOVCARPETA_ESCRITURA=1`) sin permiso explícito. Nunca commitear secretos; usar `.env.example`. La Registraduría sigue simulada (B-06).
- Reglas visuales y de contenido: `docs/diseno/DESIGN.md` y `docs/diseno/REGLAS.md`.
