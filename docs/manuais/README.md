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
