# Contexto: la raíz del repo (el servicio usa libs/eventos). docker compose lo fija en compose.yaml.
FROM node:22-alpine
WORKDIR /srv
COPY libs/eventos libs/eventos
RUN cd libs/eventos && npm ci --omit=dev
COPY servicios/indice/package.json servicios/indice/package-lock.json servicios/indice/
RUN cd servicios/indice && npm ci --omit=dev
COPY servicios/indice/src servicios/indice/src
WORKDIR /srv/servicios/indice
ENV NODE_ENV=production PORT=8080
USER node
EXPOSE 8080
HEALTHCHECK --interval=5s --retries=20 CMD wget -qO- http://127.0.0.1:8080/salud || exit 1
CMD ["node", "src/server.js"]
