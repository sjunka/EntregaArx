FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_OIDC_AUTHORITY
ENV VITE_OIDC_AUTHORITY=$VITE_OIDC_AUTHORITY
RUN npm run build

FROM nginx:1.29-alpine
COPY --from=build /app/dist /usr/share/nginx/html
