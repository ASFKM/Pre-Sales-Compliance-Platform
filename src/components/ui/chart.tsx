import * as React from "react";
import * as RechartsPrimitive from "recharts";

/**
 * Moldura de gráfico do produto — PORTE do componente de chart do catálogo local
 * (`~/projects/ui/components/chart-pizza/pie-chart.tsx`, cuja fonte é a pasta `UI/Componentes` do
 * Drive; referência visual https://21st.dev/@LegionWebDev/components/pie-chart). O nome da pasta
 * do catálogo diz "pizza", mas o arquivo principal dela não é uma pizza: é o wrapper genérico de
 * `recharts` — `ChartContainer` + `ChartTooltipContent` + `ChartStyle` —, que serve para qualquer
 * gráfico, série temporal inclusive. É ele que está portado aqui.
 *
 * O que MUDOU no porte, e por quê:
 *
 *  - As cores do original saem do vocabulário do shadcn/ui (`bg-background`, `text-muted-foreground`,
 *    `border-border/50`, `--chart-1..5`). Este produto não usa shadcn: o tema vive em `src/index.css`,
 *    em `@theme static`, com as escalas `brand-*`, `success-*`, `warning-*`, `danger-*` e `neutral-*`
 *    (= `slate-*`). Copiar as classes do original produziria classe INERTE — Tailwind não gera o
 *    utilitário de um token que não existe, e não há erro nenhum: o gráfico simplesmente sai sem
 *    contorno e com o eixo na cor errada. Cada uma foi traduzida para o token equivalente daqui.
 *  - O original depende de `cn()` (clsx + tailwind-merge). Nenhuma das duas está no `package.json`
 *    e nenhuma outra tela precisa delas; `cx()` abaixo junta as classes sem resolver conflito de
 *    Tailwind, o que basta porque aqui ninguém sobrescreve utilitário do container por fora.
 *  - O suporte a tema claro/escuro do original (`THEMES = { light, dark }`) saiu: o produto tem um
 *    tema só, e manter o ramo escuro seria código que nenhuma tela exercita.
 *
 * `isAnimationActive={false}` NÃO é regra deste arquivo, é de quem monta o gráfico — mas vale
 * repetir, porque a F10 do CDC 16 já pagou por isso em `HomePerformanceChart.tsx`: com a animação
 * ligada, o primeiro quadro de um gráfico `recharts` é VAZIO, e uma captura tirada nele sai sem
 * gráfico enquanto a asserção de texto passa.
 */

function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

export type ChartConfig = {
  [k in string]: {
    label?: React.ReactNode;
    color?: string;
  };
};

const ChartContext = React.createContext<{ config: ChartConfig } | null>(null);

function useChart() {
  const context = React.useContext(ChartContext);
  if (!context) {
    throw new Error("useChart precisa estar dentro de um <ChartContainer />");
  }
  return context;
}

/**
 * Injeta uma variável `--color-<chave>` por série, escopada ao gráfico pelo atributo
 * `data-chart`. É o mecanismo do componente original e a razão de ele existir: a série referencia
 * a própria cor por nome (`fill="var(--color-custo)"`) em vez de repetir o valor em cada `<Bar>`,
 * e dois gráficos na mesma página não disputam a mesma variável.
 */
function ChartStyle({ id, config }: { id: string; config: ChartConfig }) {
  const comCor = Object.entries(config).filter(([, item]) => item.color);
  if (comCor.length === 0) return null;

  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `[data-chart=${id}] {\n${comCor.map(([chave, item]) => `  --color-${chave}: ${item.color};`).join("\n")}\n}`,
      }}
    />
  );
}

export function ChartContainer({
  id,
  className,
  children,
  config,
  ...props
}: React.ComponentProps<"div"> & {
  config: ChartConfig;
  children: React.ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>["children"];
}) {
  const uniqueId = React.useId();
  const chartId = `chart-${id || uniqueId.replace(/:/g, "")}`;

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-slot="chart"
        data-chart={chartId}
        className={cx(
          "flex justify-center text-xs",
          // Os seletores do original, com os tokens deste produto: rótulo de eixo, linha de grade,
          // cursor do tooltip e contorno de foco. `recharts` desenha tudo isso inline com cores
          // fixas (#ccc, #fff), e é só por aqui que dá para trocá-las.
          "[&_.recharts-cartesian-axis-tick_text]:fill-slate-400",
          "[&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-slate-200",
          "[&_.recharts-curve.recharts-tooltip-cursor]:stroke-slate-200",
          "[&_.recharts-rectangle.recharts-tooltip-cursor]:fill-slate-100",
          "[&_.recharts-reference-line_[stroke='#ccc']]:stroke-slate-200",
          "[&_.recharts-dot[stroke='#fff']]:stroke-transparent",
          "[&_.recharts-layer]:outline-hidden",
          "[&_.recharts-sector]:outline-hidden",
          "[&_.recharts-sector[stroke='#fff']]:stroke-transparent",
          "[&_.recharts-surface]:outline-hidden",
          className,
        )}
        {...props}
      >
        <ChartStyle id={chartId} config={config} />
        <RechartsPrimitive.ResponsiveContainer>{children}</RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
}

export const ChartTooltip = RechartsPrimitive.Tooltip;

/**
 * O original derivava estas props de `React.ComponentProps<typeof Tooltip>`. Em `recharts` 3 isso
 * não compila: `payload`, `label` e companhia não estão mais no tipo público do `<Tooltip>` — são
 * injetadas pelo próprio Tooltip no elemento passado em `content`, e o tipo dele descreve só o que
 * o CHAMADOR pode escrever. Declarar o contrato do conteúdo aqui é o que torna o porte compatível
 * com a versão que este projeto usa (^3.10.1), em vez de silenciar o erro com um `as any`.
 */
interface ChartTooltipContentProps {
  active?: boolean;
  payload?: any[];
  label?: any;
  labelFormatter?: (label: any, payload: any[]) => React.ReactNode;
  labelClassName?: string;
  formatter?: (value: any, name: any, item: any, index: number, payload: any) => React.ReactNode;
  color?: string;
  className?: string;
  hideLabel?: boolean;
  hideIndicator?: boolean;
  indicator?: "line" | "dot" | "dashed";
  nameKey?: string;
}

export function ChartTooltipContent({
  active,
  payload,
  className,
  indicator = "dot",
  hideLabel = false,
  hideIndicator = false,
  label,
  labelFormatter,
  labelClassName,
  formatter,
  color,
  nameKey,
}: ChartTooltipContentProps) {
  const { config } = useChart();

  const tooltipLabel = React.useMemo(() => {
    if (hideLabel || !payload?.length) return null;
    const valor = labelFormatter ? labelFormatter(label, payload) : label;
    if (valor === null || valor === undefined || valor === "") return null;
    return <div className={cx("font-semibold text-slate-700", labelClassName)}>{valor}</div>;
  }, [label, labelFormatter, payload, hideLabel, labelClassName]);

  if (!active || !payload?.length) return null;

  return (
    <div
      className={cx(
        "grid min-w-40 items-start gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg",
        className,
      )}
    >
      {tooltipLabel}
      <div className="grid gap-1.5">
        {payload.map((item: any, index: number) => {
          const chave = `${nameKey || item.name || item.dataKey || "value"}`;
          const itemConfig = config[chave];
          const corDoIndicador = color || item.payload?.fill || item.color;

          return (
            <div
              key={item.dataKey ?? chave}
              className={cx("flex w-full flex-wrap items-stretch gap-2", indicator === "dot" && "items-center")}
            >
              {formatter && item?.value !== undefined && item.name ? (
                formatter(item.value, item.name, item, index, item.payload)
              ) : (
                <>
                  {!hideIndicator && (
                    <div
                      className={cx(
                        "shrink-0 rounded-xs border-(--cor-indicador) bg-(--cor-indicador)",
                        indicator === "dot" && "h-2.5 w-2.5",
                        indicator === "line" && "w-1",
                        indicator === "dashed" && "w-0 border border-dashed bg-transparent",
                      )}
                      style={{ "--cor-indicador": corDoIndicador } as React.CSSProperties}
                    />
                  )}
                  <div className="flex flex-1 items-center justify-between gap-3 leading-none">
                    <span className="text-slate-500">{itemConfig?.label ?? item.name}</span>
                    <span className="font-mono font-semibold text-slate-800 tabular-nums">
                      {item.value?.toLocaleString?.() ?? item.value}
                    </span>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
