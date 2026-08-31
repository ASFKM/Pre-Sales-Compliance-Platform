import { useEffect, useState } from "react";
import { Check, Circle } from "lucide-react";
import {
  PoliticaDeSenha,
  POLITICA_PADRAO,
  requisitosDaPolitica,
} from "../../server/utils/politicaDeSenha";

/**
 * F3 (01/09/2026) — a lista de requisitos que ACENDE ENQUANTO A PESSOA DIGITA.
 *
 * "Uma regra que só aparece no erro é uma regra que se descobre errando": antes, a tela de troca
 * obrigatória dizia apenas "mínimo de 12 caracteres", e as demais exigências (número, caractere
 * especial) só apareciam depois do envio, uma por vez.
 *
 * NADA AQUI DUPLICA A POLÍTICA. As regras vêm de `server/utils/politicaDeSenha.ts` — o mesmo
 * arquivo que o servidor usa para recusar, importado direto (neste produto o front alcança
 * `server/`, como `src/components/Workspace.tsx` já faz com `proposalTypes`) — e os VALORES vêm
 * por rota. O que roda no navegador é só a avaliação, porque o requisito tem de acender a cada
 * tecla.
 *
 * NÃO É SÓ COR: cada item tem ícone próprio e `aria-checked`, e a lista é `aria-live="polite"`,
 * para que um leitor de tela anuncie o requisito cumprido sem a pessoa sair do campo.
 */
export function usePoliticaDeSenha(token?: string): PoliticaDeSenha {
  const [politica, setPolitica] = useState<PoliticaDeSenha>(POLITICA_PADRAO);

  useEffect(() => {
    let ativo = true;
    // O tenant é resolvido pelo SERVIDOR a partir do token pendente — a tela não escolhe de quem é
    // a política que está pedindo. Sem token, o servidor devolve o padrão de fábrica.
    const url = token
      ? `/api/auth/password-policy?token=${encodeURIComponent(token)}`
      : "/api/auth/password-policy";
    fetch(url)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (ativo && data?.politica) setPolitica(data.politica as PoliticaDeSenha);
      })
      // Rede fora não pode quebrar o formulário: fica o padrão de fábrica e a pessoa continua
      // digitando. O pior caso é a lista ficar desatualizada por um instante — a decisão nunca
      // esteve aqui.
      .catch(() => undefined);
    return () => {
      ativo = false;
    };
  }, [token]);

  return politica;
}

interface Props {
  senha: string;
  politica: PoliticaDeSenha;
}

export default function RequisitosDeSenha({ senha, politica }: Props) {
  const requisitos = requisitosDaPolitica(senha, politica);

  return (
    <ul className="mt-1.5 space-y-0.5" aria-live="polite" aria-label="Requisitos da senha">
      {requisitos.map((r) => (
        <li
          key={r.chave}
          role="checkbox"
          aria-checked={r.atendido}
          className={`flex items-center gap-1.5 text-[10px] ${r.atendido ? "text-emerald-600" : "text-slate-500"}`}
        >
          {r.atendido ? (
            <Check className="w-3 h-3 shrink-0" aria-hidden="true" />
          ) : (
            <Circle className="w-3 h-3 shrink-0" aria-hidden="true" />
          )}
          <span>{r.texto}</span>
        </li>
      ))}
      {politica.historico_de_reuso > 0 && (
        // A tela não consegue avaliar este: só o servidor sabe quais senhas a pessoa já usou, e é
        // assim que tem de ser. Aparece como aviso, sem ✓ nem ○, para não prometer uma
        // verificação que não acontece aqui.
        <li className="flex items-center gap-1.5 text-[10px] text-slate-500">
          <span aria-hidden="true" className="w-3 text-center">
            ·
          </span>
          <span>Não pode repetir as últimas {politica.historico_de_reuso} senhas</span>
        </li>
      )}
    </ul>
  );
}
