import { Agent, fetch as undiciFetch } from "undici";
import { dbStore } from "../../src/dbStore";
import { decryptSecret } from "./security";
import type { AiTaskType } from "../../src/aiOrchestrator";

// The 3 built-in providers are the only ones the managed AI serves. This stays a string (not a
// fixed union) because ConnectedProvider is what the orchestrator's resolution carries around;
// anything outside the three is rejected by the Fleet Manager, not here.
export type ConnectedProvider = string;

// F4 (rodada 09/2026): de onde a chamada nasceu. Não é a tarefa (isso é `taskKey`) nem quem é o
// dono (isso é `actorRef`) - é o TIPO de gatilho, e é o que permite separar, na conta do cliente,
// gasto que alguém provocou clicando de gasto que o produto provocou sozinho:
//   `user_action`     - requisição HTTP com usuário autenticado, esperando a resposta na tela.
//   `background_task` - trabalho assíncrono que a UI enfileirou e um BackgroundTask acompanha.
//                       Tem dono (quem enfileirou), mas ninguém está olhando a tela naquele
//                       instante.
//   `scheduled_job`   - disparado por relógio ou por heartbeat, sem nenhuma ação humana no ciclo.
// O CMSaaS aceita `trigger_type` como string livre de até 60 caracteres (ProxyRequestSchema em
// server/routes/aiProxy.ts, lado dele); a união fechada é DESTE lado, para que um valor novo
// entre por edição de código e não por acidente de digitação num call site.
export type AiTriggerType = "user_action" | "background_task" | "scheduled_job";

// Prefixo de `actorRef`. O CMSaaS grava a string inteira em AiProxyUsageLog.actorRef e a usa como
// chave de agrupamento nos relatórios de consumo - ou seja, é identificador, não texto livre, e
// duas origens diferentes nunca podem colidir. Daí o prefixo:
//   `user:<id>`      - o usuário do PreSales que provocou a chamada, pelo id interno dele.
//   `system:<fluxo>` - nenhum usuário no ciclo (reconciliação da base de conhecimento, retomada
//                      de fila). O sufixo nomeia o fluxo, para que "gasto sem dono" não vire um
//                      balde único onde três coisas diferentes se somam.
// Limite do outro lado: 200 caracteres, sem caracteres de controle. Nenhuma das duas formas chega
// perto disso, mas esta função trunca e limpa em vez de deixar o proxy devolver 400 e derrubar a
// chamada de IA por causa do rótulo dela - atribuição ruim não pode custar a funcionalidade.
export function buildActorRef(kind: "user" | "system", id: string | null | undefined): string | undefined {
  if (!id) return undefined;
  const limpo = String(id).replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!limpo) return undefined;
  return `${kind}:${limpo}`.slice(0, 200);
}

// F4: a atribuição completa de UMA chamada de IA. Substitui os três rótulos fixos
// ("document_json"/"chat_text"/"web_search") que as funções de despacho mandavam antes - aqueles
// diziam por qual das três portas a chamada saiu, não o que o produto estava fazendo, e por isso
// a conta do cliente no CMSaaS mostrava três linhas para onze tarefas.
//
// `taskKey` é `AiTaskType`, não `string`: é a MESMA chave que nomeia as colunas de
// platform_settings (`${taskType}_provider` / `_model`), que o heartbeat declara em
// `ai_task_catalog` e que o CMSaaS grava em AiProxyUsageLog.taskType. String solta aqui
// significaria que o próximo call site pode inventar um nome e a bilhetagem volta a divergir sem
// nada quebrar.
//
// `agent_key` existe no proxy e NÃO é enviado de propósito: é a chave do agente que executou, e o
// PreSales não tem conceito de agente (o CMCRM tem - ver TAREFAS_CMCRM no CMSaaS). Preencher com
// o nome da tarefa duplicaria `task_type` e faria o relatório por agente mentir.
export interface AiCallAttribution {
  taskKey: AiTaskType;
  actorRef?: string;
  triggerType: AiTriggerType;
}

async function getFleetManagerProxyConfig(): Promise<{ baseUrl: string; apiKey: string }> {
  const settings = await dbStore.getSettings();
  if (!settings.fleet_manager_url || !settings.fleet_manager_api_key_encrypted) {
    throw new Error("A IA gerenciada está ativa, mas a conexão com o Fleet Manager não está configurada corretamente. Contate o suporte.");
  }
  return { baseUrl: settings.fleet_manager_url, apiKey: decryptSecret(settings.fleet_manager_api_key_encrypted) };
}

// Single call point for all 3 ai-proxy endpoints on the Fleet Manager side. Até a F4 o `taskType`
// daqui era um de três rótulos fixos escolhidos pela porta de saída, "best-effort" por decisão
// explícita de manter as assinaturas de baixo intactas; agora o chamador diz a tarefa real e a
// atribuição inteira viaja junto - é a única coisa que o CMSaaS pode usar para responder "quem
// gastou o quê" sem adivinhar.
async function callFleetManagerAiProxy(
  endpoint: "generate-json" | "generate-text" | "search-web",
  attribution: AiCallAttribution,
  provider: string,
  model: string,
  prompt: string,
  files?: ProviderFileInput[]
): Promise<ProviderJsonResult> {
  const { baseUrl, apiKey } = await getFleetManagerProxyConfig();
  const proxyTimeoutMs = Number(process.env.AI_PROXY_TIMEOUT_MS) || 1_800_000;
  const res = await undiciFetch(`${baseUrl}/api/ai-proxy/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      task_type: attribution.taskKey,
      provider,
      model,
      prompt,
      files: (files || []).map((f) => ({ mime_type: f.mimeType, base64_data: f.base64Data })),
      // Omitidos (não `null`) quando não há o que dizer: o schema do outro lado os declara
      // opcionais justamente para que uma chamada sem dono continue sendo cobrada, só que sem
      // aparecer sob um ator específico. `agent_key` nunca é enviado - ver AiCallAttribution.
      actor_ref: attribution.actorRef,
      trigger_type: attribution.triggerType,
    }),
    // How long a real analysis can legitimately take has no fixed ceiling - a large enough tender
    // document (many pages, multiple attachments) can genuinely need a long time to fully process,
    // and a hardcoded number here just relocates the same "timed out on a big real document"
    // failure to a different number instead of removing it (already happened twice: 150s -> 300s,
    // still too short). Configurable via env instead; default generous (30min).
    signal: AbortSignal.timeout(proxyTimeoutMs),
    // The actual root cause of a real production failure this raced past both of the above:
    // Node's global fetch() (undici) has its OWN internal headersTimeout, 300s by DEFAULT,
    // completely independent of the AbortSignal above - it fires the instant the Fleet Manager
    // takes longer than 5 minutes to send back response headers, which it can't do until the
    // whole Anthropic/Gemini/OpenAI call has finished generating (a single buffered res.json(),
    // not a stream relayed through). Using undici's fetch explicitly (not the global one) so a
    // per-call dispatcher can override both headersTimeout and bodyTimeout to the same budget as
    // the outer AbortSignal, instead of a hidden, shorter ceiling nobody configured on purpose.
    dispatcher: new Agent({ headersTimeout: proxyTimeoutMs, bodyTimeout: proxyTimeoutMs }),
  } as any);
  const data = await res.json().catch(() => ({})) as any;
  if (!res.ok || !data.success) {
    throw new Error(data?.message || `Falha ao chamar o proxy de IA do Fleet Manager (HTTP ${res.status}).`);
  }
  return {
    text: data.text || "",
    inputTokens: data.input_tokens || 0,
    outputTokens: data.output_tokens || 0,
    billedCostUsd: typeof data.billed_cost_usd === "number" ? data.billed_cost_usd : undefined,
  };
}

export interface ProviderJsonResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  // Set by the Fleet Manager's ia_kb proxy - the actual amount billed to the tenant (real
  // provider cost + markup), computed there since the markup percentage and the CMSaaS's own
  // pricing table must never be exposed to the Presales side. Callers must prefer this over a
  // local estimateCostUsd() re-estimate, since a local estimate never includes the markup and
  // always understates what was billed.
  billedCostUsd?: number;
}

export interface ProviderFileInput {
  mimeType: string;
  base64Data: string;
}

// F4 (rodada 09/2026): as três funções abaixo NÃO têm mais um caminho alternativo. Até aqui cada
// uma começava com `if (os 3 embutidos && await isIaKbActive()) { proxy }` seguida de ~90 linhas
// que falavam direto com o SDK do provedor usando uma chave local - e `isIaKbActive()` era
// `return true` desde a F11, então aquelas 90 linhas eram inalcançáveis por VALOR, não por
// ausência: bastava alguém devolver `false` ali (ou pedir um provedor fora dos três) para o
// produto voltar a gastar por fora da bilhetagem do CMSaaS, sem erro nenhum. O ramo, as funções
// de chave local, os SDKs (`openai`, `@anthropic-ai/sdk`, `@google/genai`) e
// `server/utils/gemini.ts` saíram do código e do package.json. O que impede a volta é
// `server/utils/aiProviders.closure.test.ts`, que falha se qualquer arquivo de server/ ou src/
// voltar a importar um SDK de provedor, ou se o package.json voltar a declará-lo como dependência.

// Single JSON-generating entry point across all three connected providers - callers always get
// back raw text they can JSON.parse (plus real token usage, for real cost tracking - see
// aiPricing.ts). `files` lets a caller hand over real document binaries (PDF/image) instead of
// pre-extracted text - needed because some real-world PDFs (scanned documents, or ones using a
// font encoding with no ToUnicode map) have no text a local extractor can ever recover; all three
// providers read the document directly via native vision/OCR instead.
export async function generateJsonWithProvider(
  provider: ConnectedProvider,
  model: string,
  prompt: string,
  attribution: AiCallAttribution,
  files?: ProviderFileInput[]
): Promise<ProviderJsonResult> {
  return callFleetManagerAiProxy("generate-json", attribution, provider, model, prompt, files);
}

// Same dispatch as generateJsonWithProvider, but for conversational free-text answers (the spec
// copilot chat) - no forced JSON response format/instruction, since a JSON object isn't what a
// chat answer should look like. `files` lets the copilot answer questions about vision-only
// documents (scanned PDFs with no extractable text) the same way the main analysis pipeline does.
export async function generateTextWithProvider(
  provider: ConnectedProvider,
  model: string,
  prompt: string,
  attribution: AiCallAttribution,
  files?: ProviderFileInput[]
): Promise<ProviderJsonResult> {
  return callFleetManagerAiProxy("generate-text", attribution, provider, model, prompt, files);
}

// Real web search, not the model's own training-data guess - used for the BOM's part-number
// lookup (web_grounding task). Which provider-side tool actually performs the search (Gemini's
// googleSearch, Anthropic's web_search, OpenAI's search model) is decided by the Fleet Manager,
// not here.
export async function searchWebWithProvider(
  provider: ConnectedProvider,
  model: string,
  prompt: string,
  attribution: AiCallAttribution
): Promise<ProviderJsonResult> {
  return callFleetManagerAiProxy("search-web", attribution, provider, model, prompt);
}
