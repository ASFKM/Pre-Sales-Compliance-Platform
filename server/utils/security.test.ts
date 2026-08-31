import { describe, it, expect } from "vitest";
import crypto from "crypto";
import {
  hashPassword,
  comparePasswords,
  encryptSecret,
  decryptSecret,
  maskSecret,
  sanitizeAndMaskObject,
  generateTotpSecret,
  buildTotpEnrollmentUri,
  verifyTotpCode,
} from "./security";
import {
  POLITICA_PADRAO,
  LIMITES_DA_POLITICA,
  normalizarPolitica,
  violacoesDaPolitica,
} from "./politicaDeSenha";

describe("password hashing", () => {
  it("hashes and verifies a correct password", () => {
    const hash = hashPassword("correct horse battery staple");
    expect(comparePasswords("correct horse battery staple", hash)).toBe(true);
  });

  it("rejects a wrong password", () => {
    const hash = hashPassword("correct horse battery staple");
    expect(comparePasswords("wrong password", hash)).toBe(false);
  });

  it("produces a different hash each time (random salt)", () => {
    const a = hashPassword("same input");
    const b = hashPassword("same input");
    expect(a).not.toBe(b);
    expect(comparePasswords("same input", a)).toBe(true);
    expect(comparePasswords("same input", b)).toBe(true);
  });

  // F1 (31/08/2026): o inverso do que este teste afirmava. O ramo SHA-256 SEM SALT nao voltou
  // junto com a autenticacao propria, e um hash nesse formato deixa de autenticar - inclusive
  // com a senha certa. Nao ha registro nesse formato para quebrar: a migration destrutiva de
  // 30/08 apagou todos os hashes antes desta volta.
  it("recusa hash legado em SHA-256 sem sal, mesmo com a senha certa", () => {
    const legacyHash = crypto.createHash("sha256").update("legacy-password").digest("hex");
    expect(comparePasswords("legacy-password", legacyHash)).toBe(false);
    expect(comparePasswords("wrong-password", legacyHash)).toBe(false);
  });

  // F3 (01/09/2026): a constante saiu. O que este teste guarda agora e o PADRAO DE FABRICA da
  // politica configuravel - o valor que vale numa instalacao que nunca abriu a tela. Baixar este
  // 12 seria a mesma regressao que baixar a constante era, so que passando despercebida por vir
  // de um "default".
  it("o padrao de fabrica da politica exige 12 caracteres, numero e caractere especial", () => {
    expect(POLITICA_PADRAO.comprimento_minimo).toBe(12);
    expect(POLITICA_PADRAO.exigir_numero).toBe(true);
    expect(POLITICA_PADRAO.exigir_especial).toBe(true);
  });

  it("o chao do comprimento minimo e 8 - a tela nao pode desfazer a saida dos 8 caracteres", () => {
    expect(LIMITES_DA_POLITICA.comprimento_minimo.minimo).toBe(8);
    expect(normalizarPolitica({ comprimento_minimo: 4 }).comprimento_minimo).toBe(8);
  });

  it("acento e letra, nao caractere especial", () => {
    const politica = { ...POLITICA_PADRAO, exigir_especial: true, exigir_numero: false };
    // "senhacomacentoa" + "e" acentuado: 15 letras, nenhuma pontuacao.
    expect(violacoesDaPolitica("senhacomacento\u00e9", politica).length).toBe(1);
    expect(violacoesDaPolitica("senhacomacento!", politica).length).toBe(0);
  });

  it("rejects garbage hash values instead of throwing", () => {
    expect(comparePasswords("anything", "not-a-real-hash")).toBe(false);
    expect(comparePasswords("anything", "")).toBe(false);
  });
});

describe("secret encryption (AES-256-GCM)", () => {
  it("round-trips a secret", () => {
    const encrypted = encryptSecret("sk_live_super_secret_value");
    expect(encrypted).not.toContain("sk_live_super_secret_value");
    expect(decryptSecret(encrypted)).toBe("sk_live_super_secret_value");
  });

  it("produces authenticated ciphertext that fails to decrypt if tampered", () => {
    const encrypted = encryptSecret("another-secret");
    const tampered = encrypted.slice(0, -2) + (encrypted.slice(-2) === "aa" ? "bb" : "aa");
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("decrypts legacy AES-256-CBC values (iv:ciphertext format)", () => {
    const key = crypto.createHash("sha256").update(process.env.SECRET_ENCRYPTION_KEY as string).digest();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
    let encrypted = cipher.update("legacy-cbc-secret", "utf8", "hex");
    encrypted += cipher.final("hex");
    const legacyFormat = `${iv.toString("hex")}:${encrypted}`;

    expect(decryptSecret(legacyFormat)).toBe("legacy-cbc-secret");
  });

  it("returns empty string for empty input", () => {
    expect(decryptSecret("")).toBe("");
  });
});

describe("maskSecret", () => {
  it("masks long secrets showing only the edges", () => {
    expect(maskSecret("sk_live_1234567890abcdef")).toBe("sk_l...cdef");
  });

  it("fully masks short secrets", () => {
    expect(maskSecret("short")).toBe("********");
  });

  it("returns empty string for empty input", () => {
    expect(maskSecret("")).toBe("");
  });
});

describe("sanitizeAndMaskObject", () => {
  it("masks known sensitive keys recursively", () => {
    const sanitized = sanitizeAndMaskObject({
      user: "alex",
      password: "supersecretvalue",
      nested: { api_key: "sk_1234567890abcdef", safe: "keep-me" },
    });

    expect(sanitized.user).toBe("alex");
    expect(sanitized.password).not.toBe("supersecretvalue");
    expect(sanitized.nested.api_key).not.toBe("sk_1234567890abcdef");
    expect(sanitized.nested.safe).toBe("keep-me");
  });

  it("does not mutate the original object", () => {
    const original = { token: "abcdef1234567890" };
    const sanitized = sanitizeAndMaskObject(original);
    expect(original.token).toBe("abcdef1234567890");
    expect(sanitized.token).not.toBe(original.token);
  });
});

describe("TOTP MFA", () => {
  it("generates a secret that produces a code verifyTotpCode accepts", async () => {
    const { generate } = await import("otplib");
    const secret = generateTotpSecret();
    const code = await generate({ secret });

    expect(await verifyTotpCode(secret, code)).toBe(true);
  });

  it("rejects an incorrect code", async () => {
    const secret = generateTotpSecret();
    expect(await verifyTotpCode(secret, "000000")).toBe(false);
  });

  it("builds a valid otpauth:// enrollment URI", () => {
    const secret = generateTotpSecret();
    const uri = buildTotpEnrollmentUri("user@example.com", secret);

    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(uri).toContain(encodeURIComponent("user@example.com"));
  });
});
