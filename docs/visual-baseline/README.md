# Baseline visual

Retrato da interface do produto, capturado tela a tela, que serve de referência para provar que
uma mudança de cor mudou **só** a cor.

Existe por causa do programa de identidade visual
([`../roadmap/IDENTIDADE_VISUAL_2026-08.md`](../roadmap/IDENTIDADE_VISUAL_2026-08.md)): as fases 2
a 7 repaletizam cerca de 2.900 classes de cor em 22 componentes. Antes da Fase 0 este projeto não
tinha nenhuma ferramenta de captura visual — só `vitest` — e as imagens dos manuais foram feitas à
mão. Repaletizar sem isto aqui era o maior risco do programa.

## O que tem aqui

| Diretório | Largura | Tamanho da janela |
|---|---|---|
| `desktop-1440/` | 1440px | 1440×900 |
| `mobile-390/` | 390px | 390×844 |

18 telas em cada, o mesmo conjunto nos dois. A lista, a navegação até cada uma e as opções de
recorte vivem em [`../../scripts/uiScreens.ts`](../../scripts/uiScreens.ts) — é de lá que sai tanto
a gravação quanto a comparação, de propósito: duas listas separadas divergiriam na primeira fase e
a comparação passaria a medir a diferença entre os dois scripts.

Estas imagens foram gravadas em **24/08/2026**, com o visual verde original, antes de qualquer
mudança de cor.

## Como usar

Tudo roda no `home-comercial-01`, como `sakae`, com o servidor de dev no ar:

```bash
npm run test:visual                             # compara a interface viva com estas imagens
npm run test:visual -- --project=desktop-1440   # só uma largura
npm run test:visual -- -g workspace             # só as telas da Área de Trabalho
npm run capture:ui                              # regrava estas imagens
npm run capture:ui -- --out /tmp/depois         # grava em outro lugar, sem tocar no baseline
```

A tolerância é **zero pixel de diferença**. Numa fase de repaletização "quase igual" não prova
nada. Quando uma fase mudar cor de propósito, regrave com `npm run capture:ui` e **revise as
imagens novas no PR** — nunca afrouxe a tolerância no `playwright.config.ts`.

## O que você precisa saber antes de confiar num verde

- **Credenciais.** A captura usa uma conta dedicada, com MFA desligado, lida de
  `.env.capture.local` (ignorado pelo git). As credenciais de seed do `prisma/seed.ts` não servem:
  o servidor de dev roda com `APP_RUNTIME_MODE=production` e recusa a senha demo de propósito.
- **`CAPTURE_PROJECT_ID`** fixa qual projeto abre na Área de Trabalho. Sem ele o script abre o
  primeiro da lista e o baseline fica refém da ordenação do banco.
- **O recorte é de uma tela, não da página inteira.** O shell é `h-screen` com `overflow-hidden` e
  a rolagem acontece dentro dos painéis: o que está abaixo da dobra **não é comparado**. Uma fase
  que mexa em tela longa deve acrescentar entradas roladas em `SCREENS` antes de confiar num
  verde.
- **A comparação depende do dado do banco de dev.** Um projeto novo, uma POC nova ou um log de
  auditoria a mais mudam a tela e aparecem como diferença. Isso é uma característica, não um
  defeito — mas quando acontecer, a diferença precisa ser explicada, e não regravada por reflexo.
- **Orçamento de requisições.** O servidor limita 1.000 requisições e 20 logins por IP a cada 15
  minutos (`server/middleware/security.ts`). Uma rodada completa custa ~154 requisições e um
  login, então cabem várias na mesma janela — mas se alguma vez o servidor recusar, a rede falha
  com a mensagem certa em vez de ficar esperando o `<nav>` aparecer. Foi um erro real: a primeira
  versão desta rede gastava ~1.000 requisições por rodada e a segunda rodada morria inteira,
  com a aparência de um defeito de interface.
