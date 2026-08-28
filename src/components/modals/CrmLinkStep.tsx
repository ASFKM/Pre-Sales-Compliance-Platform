import { useEffect, useState } from "react";
import { Building2, Check, Loader2, Search } from "lucide-react";

// CDC 16 — Fase 6. O passo do CRM no caminho secundário (D12/D13/D31/D34).
//
// Aparece DEPOIS de o projeto existir, e é o contrato que manda: `POST /opportunities` exige
// `presales_project_id`, então a oportunidade nasce sabendo a qual projeto corresponde. O efeito
// colateral é o que se quer: o projeto nasce mesmo com o CRM fora do ar, e o vínculo pode ser
// feito depois.
//
// Sem par, este componente não é montado — quem decide é `GET /api/crm/status`, e o modo
// standalone (D12) continua sendo exatamente o que era.

interface OportunidadeAberta {
  crm_opportunity_id: string;
  name: string;
  stage: string;
  value: number;
}

interface Candidata {
  crm_company_id: string;
  name: string;
  legal_name?: string;
  tax_id?: string;
  owner?: { name: string };
  confidence: number;
  open_opportunities: OportunidadeAberta[];
}

export interface CrmStatus {
  ativo: boolean;
  motivo?: string;
  organizationId?: string | null;
  organizations?: Array<{ id: string; name: string }>;
}

interface CrmLinkStepProps {
  locale: string;
  projectId: string;
  /** O que preenche a primeira busca: o CNPJ que a extração achou no edital, quando achou. */
  taxIdSugerido?: string;
  nomeSugerido: string;
  nomeDaOportunidade: string;
  status: CrmStatus;
  onDone: (resultado: { vinculado: boolean; semDono?: boolean }) => void;
}

const ROTULO_DO_CASAMENTO: Record<string, string> = {
  exact_tax_id: "CNPJ exato",
  cnpj_root: "mesma raiz de CNPJ (matriz ou filial)",
  name_candidates: "por nome — confira antes de vincular",
  none: "nenhuma candidata",
};

export default function CrmLinkStep({
  locale,
  projectId,
  taxIdSugerido,
  nomeSugerido,
  nomeDaOportunidade,
  status,
  onDone,
}: CrmLinkStepProps) {
  const pt = locale === "pt";
  const [organizacao, setOrganizacao] = useState(status.organizationId ?? "");
  const [termo, setTermo] = useState(taxIdSugerido || nomeSugerido);
  const [buscando, setBuscando] = useState(false);
  const [casamento, setCasamento] = useState<string>("");
  const [candidatas, setCandidatas] = useState<Candidata[] | null>(null);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [criandoEmpresa, setCriandoEmpresa] = useState(false);
  const [nomeDaEmpresaNova, setNomeDaEmpresaNova] = useState(nomeSugerido);
  const [cnpjDaEmpresaNova, setCnpjDaEmpresaNova] = useState(taxIdSugerido ?? "");

  const precisaEscolherOrganizacao = !organizacao && (status.organizations?.length ?? 0) > 1;

  // A primeira busca sai sozinha quando já há por onde começar: quem acabou de subir um edital
  // com CNPJ não deve ter de digitá-lo de novo para ver a empresa que já existe lá.
  useEffect(() => {
    if (!precisaEscolherOrganizacao && termo.trim().length >= 3 && candidatas === null) {
      void buscar();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [precisaEscolherOrganizacao]);

  async function escolherOrganizacao(id: string) {
    setErro("");
    const res = await fetch("/api/crm/organization", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organization_id: id }),
    });
    const data = await res.json();
    if (!res.ok) {
      setErro(data.message || (pt ? "Não foi possível guardar a escolha." : "Could not save."));
      return;
    }
    setOrganizacao(id);
  }

  async function buscar() {
    const alvo = termo.trim();
    if (alvo.length < 3) {
      setErro(pt ? "Informe ao menos três caracteres." : "Type at least three characters.");
      return;
    }
    setBuscando(true);
    setErro("");
    try {
      // Só dígitos e comprimento de CNPJ vira busca por CNPJ; o resto é nome. A decisão é da
      // tela porque é ela que sabe o que a pessoa digitou — o contrato aceita os dois em
      // parâmetros separados de propósito.
      const digitos = alvo.replace(/\D/g, "");
      const params =
        digitos.length === 14
          ? `tax_id=${encodeURIComponent(digitos)}`
          : `name=${encodeURIComponent(alvo)}`;
      const res = await fetch(`/api/crm/companies/search?${params}`);
      const data = await res.json();
      if (!res.ok) {
        setErro(data.message || (pt ? "A busca não completou." : "Search failed."));
        setCandidatas([]);
        return;
      }
      setCasamento(data.match_kind ?? "none");
      setCandidatas(data.candidates ?? []);
    } catch {
      setErro(pt ? "Erro inesperado na busca." : "Unexpected search error.");
      setCandidatas([]);
    } finally {
      setBuscando(false);
    }
  }

  async function vincular(corpo: Record<string, unknown>) {
    setSalvando(true);
    setErro("");
    try {
      const res = await fetch(`/api/crm/projects/${projectId}/link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      });
      const data = await res.json();
      if (!res.ok) {
        setErro(data.message || (pt ? "Não foi possível vincular." : "Could not link."));
        return;
      }
      onDone({ vinculado: true, semDono: Boolean(data.unassigned) });
    } catch {
      setErro(pt ? "Erro inesperado ao vincular." : "Unexpected error linking.");
    } finally {
      setSalvando(false);
    }
  }

  if (precisaEscolherOrganizacao) {
    return (
      <div className="p-6 space-y-4 text-xs text-slate-700 overflow-y-auto flex-1">
        <p className="text-slate-500">
          {pt
            ? "Mais de uma organização do CMCRM habilitou a integração de pré-vendas. Escolha a qual esta instalação corresponde — a escolha vale para as próximas vezes."
            : "More than one CMCRM organization enabled the pre-sales integration. Pick which one this installation belongs to."}
        </p>
        {erro && <div className="p-3 rounded bg-danger-50 border border-danger-200 text-danger-900">{erro}</div>}
        <div className="space-y-1.5">
          {(status.organizations ?? []).map((o) => (
            <button
              key={o.id}
              onClick={() => void escolherOrganizacao(o.id)}
              className="w-full text-left p-2.5 bg-slate-50 border border-slate-200 rounded hover:border-brand-500 cursor-pointer"
            >
              <span className="font-bold text-slate-700">{o.name}</span>
            </button>
          ))}
        </div>
        <div className="flex justify-end pt-4 border-t border-slate-200">
          <button
            type="button"
            onClick={() => onDone({ vinculado: false })}
            className="px-3 py-1.5 border border-slate-300 rounded hover:bg-slate-100 font-mono text-xs cursor-pointer text-slate-500"
          >
            {pt ? "Pular por enquanto" : "Skip for now"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4 text-xs text-slate-700 overflow-y-auto flex-1">
      <p className="text-slate-500">
        {pt
          ? "Procure o cliente no CRM antes de criar outro cadastro. Encontrando uma oportunidade aberta, vincule a ela em vez de abrir uma segunda."
          : "Look the customer up in the CRM before creating another record. If there is an open opportunity, link to it instead of opening a second one."}
      </p>

      <div className="flex gap-2">
        <input
          value={termo}
          onChange={(e) => setTermo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void buscar();
          }}
          placeholder={pt ? "CNPJ ou nome da empresa" : "Tax ID or company name"}
          className="flex-1 border border-slate-300 rounded px-2 py-1.5 text-xs"
        />
        <button
          onClick={() => void buscar()}
          disabled={buscando}
          className="bg-slate-900 hover:bg-slate-800 text-white font-mono text-xs font-bold py-1.5 px-3 rounded flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
        >
          {buscando ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
          {pt ? "Procurar" : "Search"}
        </button>
      </div>

      {erro && <div className="p-3 rounded bg-danger-50 border border-danger-200 text-danger-900">{erro}</div>}

      {candidatas !== null && (
        <div className="space-y-2">
          <p className="text-[11px] text-slate-500 font-mono uppercase tracking-wider">
            {candidatas.length === 0
              ? pt
                ? "Nenhuma empresa encontrada"
                : "No company found"
              : `${candidatas.length} ${pt ? "candidata(s)" : "candidate(s)"} · ${ROTULO_DO_CASAMENTO[casamento] ?? casamento}`}
          </p>

          {candidatas.map((c) => (
            <div key={c.crm_company_id} className="p-3 bg-slate-50 border border-slate-200 rounded space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-bold text-slate-700">{c.name}</p>
                  {c.legal_name && c.legal_name !== c.name && (
                    <p className="text-[11px] text-slate-500">{c.legal_name}</p>
                  )}
                  <p className="text-[11px] text-slate-500">
                    {c.tax_id ? c.tax_id : pt ? "sem CNPJ" : "no tax id"}
                    {" · "}
                    {c.owner
                      ? `${pt ? "responsável" : "owner"}: ${c.owner.name}`
                      : pt
                        ? "sem responsável — a oportunidade nasce na fila de sem dono"
                        : "no owner — the opportunity starts unassigned"}
                  </p>
                </div>
                <button
                  onClick={() =>
                    void vincular({
                      crm_company_id: c.crm_company_id,
                      opportunity_name: nomeDaOportunidade,
                    })
                  }
                  disabled={salvando}
                  className="shrink-0 bg-brand-600 hover:bg-brand-700 text-white font-mono text-[11px] font-bold py-1 px-2.5 rounded cursor-pointer disabled:opacity-60"
                >
                  {pt ? "Nova oportunidade" : "New opportunity"}
                </button>
              </div>

              {c.open_opportunities.length > 0 && (
                <div className="space-y-1 border-t border-slate-200 pt-2">
                  <p className="text-[10px] text-slate-500 font-mono uppercase tracking-wider">
                    {pt ? "Oportunidades abertas" : "Open opportunities"}
                  </p>
                  {c.open_opportunities.map((o) => (
                    <div key={o.crm_opportunity_id} className="flex items-center justify-between gap-3">
                      <span className="truncate">
                        {o.name} <span className="text-slate-400">· {o.stage}</span>
                      </span>
                      <button
                        onClick={() =>
                          void vincular({
                            crm_company_id: c.crm_company_id,
                            crm_opportunity_id: o.crm_opportunity_id,
                          })
                        }
                        disabled={salvando}
                        className="shrink-0 border border-brand-600 text-brand-600 hover:bg-brand-50 font-mono text-[11px] font-bold py-1 px-2.5 rounded cursor-pointer disabled:opacity-60"
                      >
                        {pt ? "Vincular a esta" : "Link to this"}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}

          {!criandoEmpresa ? (
            <button
              onClick={() => setCriandoEmpresa(true)}
              className="text-brand-600 hover:underline text-[11px] font-semibold cursor-pointer flex items-center gap-1.5"
            >
              <Building2 size={12} />
              {pt ? "Nenhuma dessas — cadastrar empresa nova no CRM" : "None of these — create a new company"}
            </button>
          ) : (
            <div className="p-3 border border-slate-200 rounded space-y-2">
              <p className="text-[11px] text-slate-500 font-mono uppercase tracking-wider">
                {pt ? "Empresa nova no CRM" : "New company in the CRM"}
              </p>
              <input
                value={nomeDaEmpresaNova}
                onChange={(e) => setNomeDaEmpresaNova(e.target.value)}
                placeholder={pt ? "Nome da empresa" : "Company name"}
                className="w-full border border-slate-300 rounded px-2 py-1.5 text-xs"
              />
              <input
                value={cnpjDaEmpresaNova}
                onChange={(e) => setCnpjDaEmpresaNova(e.target.value)}
                placeholder={pt ? "CNPJ (opcional)" : "Tax id (optional)"}
                className="w-full border border-slate-300 rounded px-2 py-1.5 text-xs"
              />
              <p className="text-[10px] text-slate-400">
                {pt
                  ? "Nenhum contato pessoal é enviado ao CRM — só a empresa."
                  : "No personal contact is sent to the CRM — only the company."}
              </p>
              <button
                onClick={() =>
                  void vincular({
                    company: {
                      name: nomeDaEmpresaNova.trim(),
                      ...(cnpjDaEmpresaNova.trim() ? { tax_id: cnpjDaEmpresaNova.trim() } : {}),
                    },
                    opportunity_name: nomeDaOportunidade,
                  })
                }
                disabled={salvando || nomeDaEmpresaNova.trim().length === 0}
                className="bg-brand-600 hover:bg-brand-700 text-white font-mono text-[11px] font-bold py-1.5 px-3 rounded cursor-pointer disabled:opacity-60 flex items-center gap-1.5"
              >
                <Check size={12} />
                {pt ? "Criar empresa e oportunidade" : "Create company and opportunity"}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="flex justify-end pt-4 border-t border-slate-200">
        <button
          type="button"
          onClick={() => onDone({ vinculado: false })}
          className="px-3 py-1.5 border border-slate-300 rounded hover:bg-slate-100 font-mono text-xs cursor-pointer text-slate-500"
        >
          {pt ? "Pular por enquanto" : "Skip for now"}
        </button>
      </div>
    </div>
  );
}
