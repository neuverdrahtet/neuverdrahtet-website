# Werkora Selfhost-Server: ein einziger Container, keine externen Dienste
# (keine separate Datenbank, kein separater Storage-Dienst) - alles läuft in
# diesem einen Prozess, Daten liegen persistent im gemounteten Volume /data.
FROM node:22-alpine

WORKDIR /app

# Das komplette Repo wird gebraucht (statische Website + verwaltung/-App),
# nicht nur selfhost-server/ - deshalb wird der Build-Kontext auf Repo-Root
# gesetzt (siehe README.md: "docker build -f selfhost-server/Dockerfile .").
COPY . .

ENV DATA_DIR=/data
ENV PORT=8080
EXPOSE 8080
VOLUME ["/data"]

CMD ["node", "--experimental-sqlite", "selfhost-server/server.js"]
