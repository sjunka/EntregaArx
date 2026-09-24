# Contexto: la raíz del repo (el servicio usa libs/eventos). docker compose lo fija en compose.yaml.
FROM node:22-alpine
WORKDIR /srv
COPY libs/eventos libs/eventos
RUN cd libs/eventos && npm ci --omit=dev
COPY servicios/afiliacion/package.json servicios/afiliacion/package-lock.json servicios/afiliacion/
RUN cd servicios/afiliacion && npm ci --omit=dev
COPY servicios/afiliacion/src servicios/afiliacion/src
WORKDIR /srv/servicios/afiliacion
ENV NODE_ENV=production PORT=8080
USER node
EXPOSE 8080
HEALTHCHECK --interval=5s --retries=20 CMD wget -qO- http://127.0.0.1:8080/salud || exit 1
CMD ["node", "src/server.js"]
