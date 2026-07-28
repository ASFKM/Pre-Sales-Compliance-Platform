# AUD-013 (auditoria de seguranca, 2026-07-19): docker-compose.yml referenciava este arquivo, que
# nunca existiu - "docker-compose up --build" (documentado no README) falhava na primeira etapa.
# Multi-stage: o estagio de build precisa das devDependencies (vite/esbuild), o de runtime nao -
# --packages=external do esbuild (ver package.json) significa que dist/server.cjs espera
# node_modules real disponivel em runtime, entao "npm ci --omit=dev" roda de novo no estagio final
# (tambem dispara "prisma generate" via postinstall, gerando o client certo pra essa imagem).

FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist

# Roda como usuario nao-root (mesma pratica ja usada no deploy real via systemd - ver
# 10-security.conf/AUD-012) - a imagem base ja vem com o usuario "node" pronto. server.ts cria
# uploads/templates no boot (bootstrap()) - sem o chown, COPY deixa /app dono de root e o
# processo crasha na primeira inicializacao com EACCES (confirmado rodando a imagem de verdade,
# nao hipotetico).
RUN mkdir -p uploads && chown -R node:node /app
USER node

EXPOSE 3000
CMD ["node", "dist/server.cjs"]
