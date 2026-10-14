FROM golang:1.27.2-bookworm@sha256:55395706e9703db746cc507abfc4eb2aea75918f8a8024e4848e2cb81004f5ad AS ssh-wasm
WORKDIR /src
COPY browser-ssh/ ./
RUN GOOS=js GOARCH=wasm CGO_ENABLED=0 go build -trimpath -o /out/client.wasm . && cp /usr/local/go/lib/wasm/wasm_exec.js /out/wasm_exec.js
FROM node:26.11.1-bookworm-slim@sha256:86f07bc9c5dce4578cf37e5a418b7bfc7f817cda25cde66e2b66e95ed86c4567 AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY scripts/patch-ssh2.cjs scripts/patch-ssh2.cjs
RUN npm ci --no-audit --no-fund
COPY tsconfig*.json ./
COPY apps apps
COPY --from=ssh-wasm /out apps/web/public/ssh
COPY packages packages
COPY scripts/bootstrap-admin.ts scripts/doctor.ts scripts/
RUN npx vite build --config apps/web/vite.config.ts && npx tsc -p tsconfig.server.json && npm prune --omit=dev
FROM node:26.11.1-bookworm-slim@sha256:86f07bc9c5dce4578cf37e5a418b7bfc7f817cda25cde66e2b66e95ed86c4567
RUN groupadd --gid 10001 exam && useradd --uid 10001 --gid 10001 --no-create-home exam
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/dist dist
COPY migrations migrations
COPY package.json ./
USER 10001:10001
EXPOSE 3000
CMD ["node","dist/apps/server/src/main.js"]
