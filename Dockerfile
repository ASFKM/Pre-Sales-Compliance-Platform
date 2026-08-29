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

# F6: conversor de template .doc -> .docx no upload (server/utils/docConversion.ts).
#
# Por que na imagem e nao numa lib Node: o motor de merge deste produto e o docxtemplater, que so
# abre OOXML (.docx e um ZIP, .doc e um binario OLE2). Nao existe conversor .doc -> .docx em
# JavaScript que preserve a formatacao do modelo - e a formatacao E o motivo de existir um
# template. Antes desta fase o .doc era aceito e depois ignorado em silencio na geracao.
#
# Custo medido, nao estimado: `apk add libreoffice-writer` traz 283 pacotes e ~955 MiB. E a maior
# parte da imagem final, e foi decisao explicita do dono do produto (a alternativa avaliada era
# recusar o .doc e pedir "salve como .docx" ao admin).
#
# ttf-dejavu/font-noto: sem nenhuma fonte instalada o LibreOffice ainda converte, mas substitui as
# fontes do documento por metricas erradas, o que desloca quebras de linha e paginacao do modelo.
RUN apk add --no-cache libreoffice-writer ttf-dejavu font-noto

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
