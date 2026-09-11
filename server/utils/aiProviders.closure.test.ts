import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RAIZ = path.join(__dirname, "..", "..");

// F4 (rodada 09/2026): TODA chamada de IA do PreSales sai pelo proxy do CMSaaS, para que ela seja
// bilhetada com tarefa, ator e gatilho reais. Até a F4 isso valia por VALOR e não por ausência:
// as três funções de despacho tinham um `if (... && await isIaKbActive())` que ia para o proxy, e
// logo abaixo ~90 linhas que falavam direto com o SDK do provedor usando uma chave local guardada
// em platform_settings. `isIaKbActive()` era `return true` fixo desde a F11, então o caminho de
// baixo era inalcançável - mas inalcançável por um `return` que qualquer edição futura poderia
// mudar sem quebrar nada, e sem nenhum teste notando que o produto voltara a gastar por fora da
// conta do cliente.
//
// Este teste olha o CÓDIGO, não o comportamento, e a distinção é o ponto: um teste que apenas
// chamasse generateJsonWithProvider() e conferisse que ela bate no proxy passaria intacto com o
// SDK de volta no bundle, bastando que o ramo do proxy continuasse ganhando. O que fecha o
// caminho é não existir mais nem a dependência nem o import.
//
// Se este teste falhar depois de uma reintrodução deliberada (um provedor novo que o CMSaaS não
// saiba fazer proxy, por exemplo), a correção NÃO é adicionar o pacote à lista de exceções daqui:
// é ensinar o proxy do CMSaaS a atendê-lo, porque um provedor que o PreSales chama direto é um
// provedor cujo custo não entra na fatura do cliente.
const SDKS_DE_PROVEDOR = [
  "openai",
  "@anthropic-ai/sdk",
  "@google/genai",
  "@google/generative-ai",
  "@mistralai/mistralai",
  "cohere-ai",
  "groq-sdk",
  "@aws-sdk/client-bedrock-runtime",
  "@azure/openai",
  "ollama",
  "replicate",
];

const DIRETORIOS_VARRIDOS = ["server", "src"];

function arquivosTypeScript(dir: string): string[] {
  const encontrados: string[] = [];
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    const completo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) {
      if (entrada.name === "node_modules" || entrada.name === "dist") continue;
      encontrados.push(...arquivosTypeScript(completo));
    } else if (/\.tsx?$/.test(entrada.name)) {
      encontrados.push(completo);
    }
  }
  return encontrados;
}

// `import x from "openai"`, `import("openai")`, `require("openai")` e `from "openai/algo"` - as
// quatro formas com que um SDK volta. O nome do pacote é escapado porque `@`/`/` aparecem nele.
function importaModulo(conteudo: string, modulo: string): boolean {
  const nome = modulo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const padrao = new RegExp(`(from\\s*|require\\(\\s*|import\\(\\s*)["'\`]${nome}(/[^"'\`]*)?["'\`]`);
  return padrao.test(conteudo);
}

describe("fechamento do caminho de IA fora do proxy do CMSaaS", () => {
  it("nenhum arquivo de server/ ou src/ importa um SDK de provedor de IA", () => {
    const arquivos = DIRETORIOS_VARRIDOS.flatMap((d) => arquivosTypeScript(path.join(RAIZ, d)));
    // Guarda contra o próprio teste virar vácuo: se a varredura parar de achar arquivos (caminho
    // errado depois de uma reorganização de pastas), ela passaria sempre, provando nada.
    expect(arquivos.length).toBeGreaterThan(50);

    const violacoes: string[] = [];
    for (const arquivo of arquivos) {
      if (arquivo === __filename || arquivo.endsWith("aiProviders.closure.test.ts")) continue;
      const conteudo = fs.readFileSync(arquivo, "utf8");
      for (const sdk of SDKS_DE_PROVEDOR) {
        if (importaModulo(conteudo, sdk)) {
          violacoes.push(`${path.relative(RAIZ, arquivo)} importa "${sdk}"`);
        }
      }
    }

    expect(violacoes).toEqual([]);
  });

  it("package.json não declara nenhum SDK de provedor de IA como dependência", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(RAIZ, "package.json"), "utf8"));
    const declaradas = Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) });
    // Mesma guarda: um package.json que não parseou em nada faria este teste passar em silêncio.
    expect(declaradas.length).toBeGreaterThan(10);

    expect(declaradas.filter((d) => SDKS_DE_PROVEDOR.includes(d))).toEqual([]);
  });

  it("aiProviders.ts não tem ramo condicional entre proxy e provedor direto", () => {
    const bruto = fs.readFileSync(path.join(RAIZ, "server", "utils", "aiProviders.ts"), "utf8");
    // Só o CÓDIGO, sem as linhas de comentário: o comentário de topo daquele arquivo explica em
    // detalhe o que era `isIaKbActive` e por que ela saiu, e é justamente esse registro que faz
    // a próxima pessoa entender o que este teste protege. Apagar a explicação para o teste passar
    // seria trocar a memória do defeito pela conveniência da asserção.
    const fonte = bruto
      .split("\n")
      .filter((linha) => !linha.trim().startsWith("//"))
      .join("\n");
    // A função que tornava o desvio possível não existe mais em lugar nenhum do repositório.
    expect(fonte).not.toMatch(/isIaKbActive/);
    // E nenhuma das três funções de despacho lê chave local de provedor. `fleet_manager_
    // _api_key_encrypted` (a credencial do PROXY) continua sendo lida e não entra nesta lista -
    // ela é o que faz a chamada ser bilhetada, não o que a faz escapar da bilhetagem.
    expect(fonte).not.toMatch(/openai_api_key_encrypted|anthropic_api_key_encrypted|\bai_api_key_encrypted/);
    expect(fonte).not.toMatch(/OPENAI_API_KEY|ANTHROPIC_API_KEY|GEMINI_API_KEY|GOOGLE_API_KEY/);
  });
});
