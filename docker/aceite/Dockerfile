FROM node:22.11.0-bookworm-slim

RUN npm install -g tsx@4.19.2

WORKDIR /opt/aceite
COPY run.sh /opt/aceite/run.sh
RUN chmod +x /opt/aceite/run.sh

USER node
ENTRYPOINT ["/bin/sh", "/opt/aceite/run.sh"]
