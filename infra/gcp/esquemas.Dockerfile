# Job de Cloud Run que registra los esquemas de contratos/eventos. Contexto: la raíz del repo.
FROM node:22-alpine
WORKDIR /app
COPY infra/registrar-esquemas.mjs .
COPY contratos/eventos eventos
CMD ["node", "registrar-esquemas.mjs", "eventos"]
