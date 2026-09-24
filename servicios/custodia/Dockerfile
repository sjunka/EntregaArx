# Contexto: la raíz del repo (el servicio usa libs/eventos). docker compose lo fija en compose.yaml.
FROM node:22-alpine
WORKDIR /srv
COPY libs/eventos libs/eventos
RUN cd libs/eventos && npm ci --omit=dev
COPY servicios/custodia/package.json servicios/custodia/package-lock.json servicios/custodia/
RUN cd servicios/custodia && npm ci --omit=dev
COPY servicios/custodia/src servicios/custodia/src
WORKDIR /srv/servicios/custodia
ENV NODE_ENV=production PORT=8080
USER node
EXPOSE 8080
HEALTHCHECK --interval=5s --retries=20 CMD wget -qO- http://127.0.0.1:8080/salud || exit 1
CMD ["node", "src/server.js"]
