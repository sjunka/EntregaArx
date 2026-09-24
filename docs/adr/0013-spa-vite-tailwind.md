# SPA con Vite, React y Tailwind v4

Estado: aceptada. Amplía ADR-0011 (AD-11).

La SPA se reescribe con Vite, React y Tailwind CSS v4, en lugar del React sin empaquetador del prototipo. Los tokens de `tokens.css` se declaran en `@theme` de Tailwind, así que `docs/diseno/DESIGN.md` sigue siendo la única fuente visual y las utilidades de Tailwind solo exponen esos tokens. La publicación estática en GitHub Pages de AD-11 no cambia. Se descartó la paleta por defecto de Tailwind porque habría roto la identidad visual ya aprobada.
