import { describe, expect, it } from "vitest";
import { montarEmissoresAceitos, emailDoToken, segundosDesdeAutenticacao } from "./keycloakAuth";

/**
 * Fase 13 — o CMSaaS passou a aceitar tokens do Keycloak, que responde por três rotas e monta o
 * `iss` a partir da rota de entrada. A allowlist de emissores e a leitura de `auth_time` são as
 * duas peças de segurança novas: um erro em qualquer uma delas não quebra nada visível, só
 * afrouxa a verificação em silêncio — que é a pior forma de um controle falhar.
 */
describe("montarEmissoresAceitos", () => {
  const REALM = "cloudmountain";

  it("monta um emissor por rota configurada", () => {
    expect(
      montarEmissoresAceitos(
        "https://192.168.3.197:8443,https://100.106.236.106:8443,https://cmcrm-dev-01.tail7af88b.ts.net:8443",
        REALM,
      ),
    ).toEqual([
      "https://192.168.3.197:8443/realms/cloudmountain",
      "https://100.106.236.106:8443/realms/cloudmountain",
      "https://cmcrm-dev-01.tail7af88b.ts.net:8443/realms/cloudmountain",
    ]);
  });

  it("tolera espaço e barra final, que é como uma lista escrita à mão costuma chegar", () => {
    expect(montarEmissoresAceitos(" https://a.exemplo:8443/ , https://b.exemplo:8443// ", REALM)).toEqual([
      "https://a.exemplo:8443/realms/cloudmountain",
      "https://b.exemplo:8443/realms/cloudmountain",
    ]);
  });

  it("descarta entrada vazia em vez de gerar o emissor '/realms/...'", () => {
    // Uma vírgula sobrando produziria `"/realms/cloudmountain"` — um emissor que casaria com
    // qualquer token cujo `iss` fosse exatamente isso, e que não pertence a lista nenhuma.
    expect(montarEmissoresAceitos("https://a.exemplo:8443,,", REALM)).toEqual([
      "https://a.exemplo:8443/realms/cloudmountain",
    ]);
  });

  it("RECUSA lista vazia em vez de devolver allowlist vazia", () => {
    // `jose` trata `issuer` ausente como "não verifique o emissor": devolver lista vazia aqui
    // desligaria a checagem sem nenhum sinal.
    expect(() => montarEmissoresAceitos("", REALM)).toThrow(/vazia/);
    expect(() => montarEmissoresAceitos("  ,  , ", REALM)).toThrow(/vazia/);
  });

  it("não aceita rota que não foi configurada", () => {
    const aceitos = montarEmissoresAceitos("https://192.168.3.197:8443", REALM);
    expect(aceitos).not.toContain("https://evil.exemplo:8443/realms/cloudmountain");
    expect(aceitos).not.toContain("https://100.106.236.106:8443/realms/cloudmountain");
  });

  it("amarra o emissor ao realm: a mesma rota em outro realm é outro emissor", () => {
    const [aceito] = montarEmissoresAceitos("https://192.168.3.197:8443", REALM);
    const [outro] = montarEmissoresAceitos("https://192.168.3.197:8443", "outro-realm");
    expect(aceito).not.toEqual(outro);
  });
});

describe("emailDoToken", () => {
  it("usa o claim email quando existe", () => {
    expect(emailDoToken({ email: "Pessoa@Exemplo.com" })).toBe("pessoa@exemplo.com");
  });

  it("cai para preferred_username, porque as contas foram criadas com username = e-mail", () => {
    expect(emailDoToken({ preferred_username: "pessoa@exemplo.com" })).toBe("pessoa@exemplo.com");
  });

  it("normaliza para minúsculas — a busca no banco é por e-mail exato", () => {
    expect(emailDoToken({ email: "MAIUSCULA@EXEMPLO.COM" })).toBe("maiuscula@exemplo.com");
  });

  it("RECUSA token sem e-mail em vez de adivinhar de quem é a sessão", () => {
    expect(() => emailDoToken({})).toThrow(/sem e-mail/);
    expect(() => emailDoToken({ preferred_username: "service-account-cmsaas" })).toThrow(/sem e-mail/);
  });
});

describe("segundosDesdeAutenticacao", () => {
  it("mede a idade da autenticação, não a do token", () => {
    const agora = Math.floor(Date.now() / 1000);
    expect(segundosDesdeAutenticacao({ auth_time: agora - 30 })).toBeGreaterThanOrEqual(29);
    expect(segundosDesdeAutenticacao({ auth_time: agora - 30 })).toBeLessThanOrEqual(31);
  });

  it("devolve null quando o token não traz auth_time", () => {
    // Quem chama trata `null` como "não posso afirmar que foi recente" e NEGA o step-up —
    // nunca como zero, que liberaria a ação sensível para qualquer token sem o claim.
    expect(segundosDesdeAutenticacao({})).toBeNull();
    expect(segundosDesdeAutenticacao({ iat: Math.floor(Date.now() / 1000) })).toBeNull();
  });
});
