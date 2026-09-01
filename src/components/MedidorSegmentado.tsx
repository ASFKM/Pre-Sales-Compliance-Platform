// O medidor segmentado do disco — portado de web/src/components/medidorSegmentado.tsx do CMSaaS
// (que por sua vez veio do card "Compliance Checks", statistics-card-13 do catálogo @sean0205),
// escolhido pelo dono para o disco porque é uma quantidade discreta que se enche, lida por
// CONTAGEM de blocos acesos — diferente da barra contínua que CPU e memória usam ali (aqui,
// AreaChart), já que disco não tem série temporal desenhada: interessa o ESTADO, não a variação.
//
// O que NÃO veio, como no original: nenhuma biblioteca visual nova. Cor de cada pílula acesa vem
// de `faixaDeUso`, a mesma função que colore os outros dois cartões.
import { faixaDeUso, corDaFaixa, percentualDeUso, formatarMb, pilulasAcesas } from "./faixaDeUso";

const TOTAL_DE_PILULAS = 30;

export function MedidorSegmentado({ usado, total, locale }: { usado: number | null | undefined; total: number | null | undefined; locale: "en" | "pt" }) {
  const percentual = percentualDeUso(usado, total);
  const faixa = faixaDeUso(percentual);
  const cor = corDaFaixa(faixa);
  const semMedida = faixa === "desconhecida";
  const acesas = pilulasAcesas(percentual, TOTAL_DE_PILULAS);

  return (
    <div className="flex flex-col justify-center h-full">
      <div
        className="flex gap-[3px]"
        role="meter"
        aria-label="Disco"
        aria-valuenow={semMedida ? undefined : Math.round(percentual!)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={semMedida ? "sem medida" : `${Math.round(percentual!)} por cento`}
      >
        {Array.from({ length: TOTAL_DE_PILULAS }).map((_, i) => (
          <span
            key={i}
            className="inline-block flex-1 h-5 rounded-[3px] transition-colors duration-500"
            style={
              i < acesas
                ? { background: cor, border: `1px solid ${cor}` }
                : { background: "var(--color-slate-100)", border: "1px solid var(--color-slate-200)" }
            }
          />
        ))}
      </div>
      <div className="flex items-center justify-between text-[10px] mt-2.5">
        <span className="text-slate-500">
          {semMedida
            ? locale === "pt" ? "sem leitura de disco" : "no disk reading"
            : `${formatarMb(usado)} / ${formatarMb(total)}`}
        </span>
        <span className="font-bold font-mono tabular-nums" style={{ color: semMedida ? "var(--color-slate-400)" : cor }}>
          {semMedida ? "—" : `${Math.round(percentual!)}%`}
        </span>
      </div>
    </div>
  );
}
