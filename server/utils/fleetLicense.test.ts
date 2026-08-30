import crypto from "crypto";
import { describe, it, expect, vi, afterEach } from "vitest";
import { canonicalJsonDeep, verifyCommandsSignature, collectSystemInfo } from "./fleetLicense";

/**
 * CDC14-F2-001 - `fleet-manager:docs/cdc/15-presales-assinatura-v2.md`.
 *
 * Até 24/08/2026 esta instalação verificava `commands_signature` (v1), que era calculada sobre
 * `JSON.stringify(payload, Object.keys(payload).sort())`. O segundo argumento do JSON.stringify
 * não é uma lista de ordenação: é um REPLACER ARRAY, aplicado recursivamente, e ele zerava todo
 * objeto aninhado. O que era verificado era sempre `{"commands":[{}],"latest_release":{}}` - o
 * `code_ref` de um apply_update podia ser trocado em trânsito sem invalidar a assinatura, e esse
 * valor segue para triggerImmediateUpdate, que faz git checkout + build + restart aqui dentro.
 *
 * Os casos deste arquivo são portados de `ASFKM/CMCRM:production/infra/temporal/test/
 * heartbeat-inbox.spec.ts`, que já guardava o mesmo achado do outro lado da fronteira.
 *
 * Não há como assinar com a chave privada do CMSaaS - ela vive só lá. Por isso o arquivo prova
 * três coisas separadas, e as três juntas cobrem o caminho:
 *
 *  1. O verificador REAL, com a chave pública do CMSaaS embutida e sem nenhum dublê, recusa
 *     assinatura ausente, assinatura de outra chave e lixo no lugar da assinatura.
 *  2. Os BYTES que `verifyCommandsSignature` de fato entrega a `crypto.verify` distinguem duas
 *     cargas que só diferem no conteúdo dos comandos. É o caso que guarda o defeito: contra a
 *     implementação antiga os dois lados desta igualdade são a mesma string, e o teste FALHA.
 *  3. Com um par Ed25519 próprio no lugar da chave embutida (único ponto injetado, para poder
 *     exercitar o ramo "assinatura válida"), uma assinatura legítima de uma carga é RECUSADA para
 *     a carga adulterada. Contra a implementação antiga ela era aceita.
 *
 * A quarta prova - um comando real do CMSaaS aceito e confirmado por uma instalação rodando este
 * código - é heartbeat de verdade, e está no registro de execução, não aqui.
 */

const comandoOriginal = [{ id: "cmd_1", type: "apply_update", payload: { release_id: "rel_1", code_ref: "v0.1.19-pricing-permission-rbac-fix" } }];
const comandoAdulterado = [{ id: "cmd_1", type: "apply_update", payload: { release_id: "rel_1", code_ref: "attacker/backdoor" } }];

const releaseOriginal = { id: "rel_1", version: "0.1.19", channel: "stable", code_ref: "v0.1.19-pricing-permission-rbac-fix", published_at: "2026-08-01T00:00:00.000Z" };
const releaseAdulterada = { ...releaseOriginal, code_ref: "attacker/backdoor" };

/** Par próprio: serve para assinar de verdade um envelope e provar que a chave ERRADA é recusada. */
const parDeTeste = crypto.generateKeyPairSync("ed25519");

function assinarComParDeTeste(envelope: unknown): string {
  return crypto.sign(null, Buffer.from(canonicalJsonDeep(envelope), "utf8"), parDeTeste.privateKey).toString("base64");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("verificador real de assinatura de comandos (chave pública do CMSaaS embutida)", () => {
  it("recusa assinatura ausente", () => {
    expect(verifyCommandsSignature(comandoOriginal, null, undefined)).toBe(false);
    expect(verifyCommandsSignature(comandoOriginal, null, "")).toBe(false);
  });

  it("recusa assinatura feita por outra chave - é o caso do CMSaaS falsificado", () => {
    const assinaturaDeOutraChave = assinarComParDeTeste({ commands: comandoOriginal, latest_release: null });
    expect(verifyCommandsSignature(comandoOriginal, null, assinaturaDeOutraChave)).toBe(false);
  });

  it("recusa lixo no lugar da assinatura sem lançar exceção", () => {
    expect(verifyCommandsSignature([], null, "isto-nao-e-base64-de-assinatura")).toBe(false);
    expect(verifyCommandsSignature([], null, "!!!")).toBe(false);
  });
});

/**
 * O caso que guarda o defeito. `crypto.verify` é espionado só para LER os bytes que a função real
 * monta - nada é substituído no caminho de decisão. Contra a v1 os dois envelopes produziam
 * `{"commands":[{}],"latest_release":{}}`, idênticos, e cada uma destas asserções falha.
 */
describe("CDC14-F2-001: os bytes verificados cobrem o CONTEÚDO dos comandos", () => {
  function bytesVerificados(commands: Parameters<typeof verifyCommandsSignature>[0], latestRelease: Parameters<typeof verifyCommandsSignature>[1]): string {
    const espiao = vi.spyOn(crypto, "verify").mockReturnValue(false as never);
    verifyCommandsSignature(commands, latestRelease, Buffer.alloc(64).toString("base64"));
    expect(espiao).toHaveBeenCalledTimes(1);
    return (espiao.mock.calls[0][1] as Buffer).toString("utf8");
  }

  it("duas cargas que só diferem no code_ref do apply_update NÃO produzem os mesmos bytes", () => {
    const bytesOriginal = bytesVerificados(comandoOriginal, null);
    vi.restoreAllMocks();
    const bytesAdulterado = bytesVerificados(comandoAdulterado, null);

    expect(bytesOriginal).not.toBe(bytesAdulterado);
    // O sintoma exato do defeito, escrito por extenso para quem reabrir este arquivo saber o que
    // procurar: era ISTO que ia para crypto.verify, qualquer que fosse o comando.
    expect(bytesOriginal).not.toBe('{"commands":[{}],"latest_release":{}}');
    expect(bytesOriginal).toContain("v0.1.19-pricing-permission-rbac-fix");
  });

  it("adulterar o code_ref de latest_release também muda os bytes verificados", () => {
    const bytesOriginal = bytesVerificados([], releaseOriginal);
    vi.restoreAllMocks();
    const bytesAdulterada = bytesVerificados([], releaseAdulterada);

    expect(bytesOriginal).not.toBe(bytesAdulterada);
    expect(bytesOriginal).toContain("v0.1.19-pricing-permission-rbac-fix");
  });

  it("os bytes verificados são exatamente o canonicalJsonDeep do envelope - a mesma receita do CMSaaS e do CMCRM", () => {
    const bytes = bytesVerificados(comandoOriginal, releaseOriginal);
    expect(bytes).toBe(canonicalJsonDeep({ commands: comandoOriginal, latest_release: releaseOriginal }));
  });

  it("canonicalJsonDeep ordena chaves em profundidade e é estável a reordenação", () => {
    const a = { b: { z: 1, a: [{ y: 2, x: 3 }] }, a: null };
    const b = { a: null, b: { a: [{ x: 3, y: 2 }], z: 1 } };
    expect(canonicalJsonDeep(a)).toBe(canonicalJsonDeep(b));
    expect(canonicalJsonDeep(a)).toBe('{"a":null,"b":{"a":[{"x":3,"y":2}],"z":1}}');
  });
});

/**
 * O ramo "assinatura válida" do verificador real, com a chave embutida trocada por um par de
 * teste. É o único ponto injetado no arquivo, e é injetado porque a alternativa seria ter a chave
 * privada do CMSaaS aqui dentro.
 */
describe("CDC14-F2-001: uma assinatura legítima não vale para a carga adulterada", () => {
  function comChaveDeTeste<T>(fn: () => T): T {
    vi.spyOn(crypto, "createPublicKey").mockReturnValue(parDeTeste.publicKey);
    return fn();
  }

  it("aceita a carga que foi realmente assinada", () => {
    const assinatura = assinarComParDeTeste({ commands: comandoOriginal, latest_release: releaseOriginal });
    expect(comChaveDeTeste(() => verifyCommandsSignature(comandoOriginal, releaseOriginal, assinatura))).toBe(true);
  });

  it("RECUSA a mesma assinatura contra um code_ref trocado em trânsito", () => {
    const assinatura = assinarComParDeTeste({ commands: comandoOriginal, latest_release: null });
    expect(comChaveDeTeste(() => verifyCommandsSignature(comandoAdulterado, null, assinatura))).toBe(false);
  });

  it("RECUSA a mesma assinatura contra um latest_release trocado em trânsito", () => {
    const assinatura = assinarComParDeTeste({ commands: [], latest_release: releaseOriginal });
    expect(comChaveDeTeste(() => verifyCommandsSignature([], releaseAdulterada, assinatura))).toBe(false);
  });
});

/**
 * F12 — a coleta de sistema do heartbeat, que até esta fase não tinha teste nenhum.
 *
 * Escrito pela ótica do que NÃO pode sair no payload: o defeito plausível aqui não derruba nada,
 * só entrega um número errado que vira medidor colorido na tela do CMSaaS, com a mesma aparência
 * de um número certo. Uma unidade trocada (bytes onde deveriam ir megabytes) passa por todo
 * typecheck e por toda montagem de payload.
 */
describe("collectSystemInfo: o que não pode sair no heartbeat", () => {
  it("não reporta disco impossível", () => {
    const info = collectSystemInfo();

    // Ausente é resposta legítima — um filesystem que recuse `statfs`. Mas ausente é diferente de
    // zero: um total zerado do outro lado vira divisão por zero.
    if (info.disk_total_mb === undefined) {
      expect(info.disk_used_mb).toBeUndefined();
      return;
    }

    expect(info.disk_total_mb).toBeGreaterThan(0);
    expect(info.disk_used_mb).toBeDefined();
    expect(info.disk_used_mb!).toBeGreaterThanOrEqual(0);
    // Usado acima do total desenharia uma barra passando de 100% na lista de instalações.
    expect(info.disk_used_mb!).toBeLessThanOrEqual(info.disk_total_mb!);
    // Guarda de unidade: em megabytes, nenhum disco real chega a 100 TB neste parque. Se a
    // conversão escapar e o valor sair em bytes, este limite estoura.
    expect(info.disk_total_mb!).toBeLessThan(1024 * 1024 * 100);
  });

  it("não deixa a coleta de disco derrubar o resto do heartbeat", () => {
    // O que não pode acontecer é uma instalação sumir do painel por causa de uma métrica
    // opcional: sem disco, o heartbeat continua saindo completo em todo o resto.
    expect(() => collectSystemInfo()).not.toThrow();
    const info = collectSystemInfo();
    expect(info.total_memory_mb).toBeGreaterThan(0);
    expect(info.memory_used_mb).toBeLessThanOrEqual(info.total_memory_mb);
    expect(info.node_version).toBe(process.version);
  });

  it("não reporta carga de CPU fora da escala que a tela desenha", () => {
    const info = collectSystemInfo();
    expect(info.cpu_load_percent).toBeGreaterThanOrEqual(0);
    // O medidor da lista pinta de 0 a 100; acima disso a barra vaza do trilho.
    expect(info.cpu_load_percent).toBeLessThanOrEqual(100);
    expect(info.cpu_cores).toBeGreaterThan(0);
  });
});
