/*
 * F10: O CONTRATO DE TECLADO DOS MODAIS DA RODADA.
 *
 * MEDIDO ANTES DE ESCREVER ISTO, com o dossiê do aprovador aberto em 1440px:
 *   - `document.activeElement` continuava no `<body>`: abrir o modal não movia o foco;
 *   - três `Tab` a partir daí levavam o foco para o botão "Rejeitar" DA TELA DE FUNDO,
 *     ou seja, com o dossiê aberto por cima era possível chegar de teclado à ação
 *     irreversível que ele existe para informar;
 *   - `Escape` não fechava nada (medido: o título do modal seguia no DOM depois da tecla).
 * Nenhum modal deste produto tinha `role="dialog"`, `aria-modal` ou tratamento de Escape —
 * a busca por "Escape" em `src/**\/*.tsx` devolvia zero linhas antes desta fase.
 *
 * O que o hook faz, e só isto:
 *   1. move o foco para dentro do modal ao montar, e o devolve a quem o abriu ao desmontar;
 *   2. mantém o Tab e o Shift+Tab circulando entre os focáveis do modal;
 *   3. fecha no Escape chamando o MESMO `onClose` do botão de fechar.
 *
 * NÃO muda o que qualquer modal faz: não grava, não valida, não decide. Fechar pelo Escape
 * é o mesmo cancelar do botão "X" que já existia — nenhuma rota nova é chamada.
 *
 * O `onClose` entra por ref para que uma função recriada a cada render (é o caso de todos os
 * três chamadores) não refaça o listener a cada digitação dentro do modal.
 */
import { useEffect, useRef } from "react";

const FOCAVEIS =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface OpcoesDoModal {
  /**
   * F10: fechar no Escape e OPCIONAL porque nem todo modal deste produto pode
   * fechar de graca. O editor de secoes (Proposals.tsx) guarda texto digitado e
   * ainda nao salvo; dar a ele um atalho de teclado novo para descartar seria
   * mudar comportamento, nao acabamento. A armadilha de foco e o `role="dialog"`
   * — que e o que falta la — valem independentemente disso.
   */
  fecharNoEscape?: boolean;
}

export function useModalDialog<T extends HTMLElement>(onClose: () => void, opcoes: OpcoesDoModal = {}) {
  const fecharNoEscape = opcoes.fecharNoEscape !== false;
  const containerRef = useRef<T | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const anterior = document.activeElement as HTMLElement | null;

    // O primeiro foco vai para o container, não para o primeiro botão: no dossiê o primeiro
    // focável é o "X" de fechar, e começar com "Fechar" anunciado é o oposto do que a tela
    // quer dizer. Com tabIndex={-1} no container, o leitor de tela anuncia o rótulo do
    // diálogo e o primeiro Tab cai no primeiro controle real.
    container.focus({ preventScroll: true });

    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (!fecharNoEscape) return;
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;

      const focaveis = Array.from(container.querySelectorAll<HTMLElement>(FOCAVEIS)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (focaveis.length === 0) {
        e.preventDefault();
        container.focus({ preventScroll: true });
        return;
      }

      const primeiro = focaveis[0];
      const ultimo = focaveis[focaveis.length - 1];
      const atual = document.activeElement as HTMLElement | null;

      // Fora do modal (o estado medido antes desta fase) o Tab volta para dentro em vez de
      // seguir para a tela de fundo.
      if (!atual || !container.contains(atual)) {
        e.preventDefault();
        (e.shiftKey ? ultimo : primeiro).focus();
        return;
      }
      if (e.shiftKey && atual === primeiro) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && atual === ultimo) {
        e.preventDefault();
        primeiro.focus();
      }
    };

    document.addEventListener("keydown", aoTeclar, true);
    return () => {
      document.removeEventListener("keydown", aoTeclar, true);
      // Devolver o foco a quem abriu: sem isto, fechar o dossiê deixa o foco no <body> e o
      // próximo Tab recomeça do topo da página, longe do botão que o abriu.
      if (anterior && document.contains(anterior)) anterior.focus({ preventScroll: true });
    };
  }, [fecharNoEscape]);

  return containerRef;
}
