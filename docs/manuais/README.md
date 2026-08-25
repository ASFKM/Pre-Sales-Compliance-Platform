# Manuais — como manter atualizados

- `MANUAL_DO_USUARIO.md` / `MANUAL_DE_ADMINISTRACAO.md`: fonte da verdade, em Markdown.
- `screenshots/`: capturas reais da aplicação, referenciadas nos `.md` via `[PRINT: nome-do-arquivo.png]`.
- `build-manual.mjs`: converte cada `.md` numa página HTML autocontida com busca embutida.

## Para editar o conteúdo

Edite o `.md` diretamente. Um novo print entra como `**[PRINT: nome-do-arquivo.png]**` numa linha
própria, com o arquivo correspondente em `screenshots/`.

## Para regenerar as páginas HTML depois de editar

Da raiz do projeto:

```bash
# Versão servida pelo app (usa caminho relativo pras imagens - precisa dos screenshots ao lado)
node docs/manuais/build-manual.mjs docs/manuais/MANUAL_DO_USUARIO.md public/manuals/manual-usuario.html "Manual do Usuário" "manual-administracao.html" "Manual de Administração"
node docs/manuais/build-manual.mjs docs/manuais/MANUAL_DE_ADMINISTRACAO.md public/manuals/manual-administracao.html "Manual de Administração" "manual-usuario.html" "Manual do Usuário"
cp docs/manuais/screenshots/*.png public/manuals/screenshots/

# Versão autocontida pra publicar como Artifact/compartilhar (embute as imagens em base64)
node docs/manuais/build-manual.mjs docs/manuais/MANUAL_DO_USUARIO.md /tmp/manual-usuario-standalone.html "Manual do Usuário" "" "" --embed
node docs/manuais/build-manual.mjs docs/manuais/MANUAL_DE_ADMINISTRACAO.md /tmp/manual-administracao-standalone.html "Manual de Administração" "" "" --embed
```

`public/manuals/` é servido pelo Vite como pasta estática (convenção `public/`) — o conteúdo vai
para `dist/manuals/` em todo build e fica acessível em `/manuals/manual-usuario.html` e
`/manuals/manual-administracao.html`. Os links no rodapé (`src/App.tsx`) e na barra lateral de
Configurações (`src/components/AdminConsole.tsx`) apontam pra essas rotas, abrindo em nova aba.

## Quando tirar novos prints

O app não usa React Router — a navegação é toda por estado (`activeTab`), então não dá pra
screenshotar por URL direta. Use Playwright pilotando a UI de verdade (clicar nas abas), num
tenant descartável dedicado a isso — nunca contra dado real de cliente.

**Desde 25/08/2026 isso está automatizado:**

```bash
npm run capture:manuals                      # regrava docs/manuais/screenshots/
npm run capture:manuals -- --out /tmp/x      # captura noutro lugar, sem tocar no que está versionado
npm run capture:manuals -- --only 03-home,14-copiloto
```

`scripts/capture-manuals.ts` percorre a interface no tenant `manual_demo_tenant`, com a conta
dedicada de `.env.manual.local` (fora do git, como a do baseline visual). A cor gravada nesse tenant
é a da marca, e a rampa derivada dela é idêntica à oficial nos onze degraus — a interface capturada
é a padrão do produto, não a de um cliente co-marcado.

Três coisas que a primeira execução ensinou e que já estão resolvidas no script:

- fora do `@playwright/test` **não existe `actionTimeout`**: um seletor que não aparece pendura a
  captura para sempre, calada. O script fixa `setDefaultTimeout`;
- **três das imagens são modais**, e o overlay `fixed inset-0` de um modal aberto intercepta o clique
  da tela seguinte — o erro aparece na navegação, apontando para o elemento errado. Cada tela começa
  fechando o que estiver aberto (recarregar a página entre telas estouraria o limitador de 1.000
  requisições por IP a cada 15 minutos);
- rótulo em caixa alta por CSS **não muda o texto do DOM**, e o do Explorador de Arquivos começa com
  um emoji: o casamento é sem diferenciar maiúsculas e tolerante a prefixo.

**Uma imagem citada no manual não é capturável por esta conta:** `sistema-atualizacao.png`, da seção
"Atualizações do Sistema" do manual de administração. A seção só aparece para quem tem a permissão
`admin:system_updates`, que o papel do tenant de demonstração **não** tem — é por isso que essa
imagem nunca existiu no diretório. Para produzi-la, é preciso conceder a permissão a esse papel
antes de rodar a captura.
