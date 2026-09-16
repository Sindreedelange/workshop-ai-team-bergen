# Standalone image for running the mock without the rest of the sandbox.
#
# docker-compose.yml does NOT use this file. It used to, and that was a trap: the
# seed is baked in below, so `docker compose up -d` reused a stale layer and served
# the four-street fixture for two weeks after a larger extract landed. Compose now
# mounts the working tree like every other service. Anything you change in
# data/ needs a rebuild here, but nowhere else.
FROM node:24-alpine

WORKDIR /app

COPY apps/matrikkel-mock/package.json ./package.json
COPY apps/matrikkel-mock/src ./src
# Til /shared og ikke ./shared: src/server.ts importerer ../../shared/…,
# som fra /app/src løser til /shared.
COPY apps/shared /shared
# De fire håndskrevne bergensgatene. Alt annet hentes fra Geonorge ved oppslag.
COPY data/matrikkel.seed.json ./data/matrikkel.seed.json
COPY data/eierforhold.json ./data/eierforhold.json

ENV PORT=8085

EXPOSE 8085

CMD ["node", "src/server.ts"]
