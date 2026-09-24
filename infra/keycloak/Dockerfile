# Keycloak del despliegue en GCP (ADR-0014). El realm se importa al arrancar; sus ${VARIABLES} salen del entorno.
FROM quay.io/keycloak/keycloak:26.0
COPY realm-carpeta.json /opt/keycloak/data/import/realm-carpeta.json
ENTRYPOINT ["/opt/keycloak/bin/kc.sh"]
CMD ["start", "--import-realm"]
