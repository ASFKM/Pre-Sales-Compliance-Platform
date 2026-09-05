#!/usr/bin/env python3
"""Emite os achados de um scanner no LOG do job, em uma linha, para o Infra Ops coletar.

    python3 infraops_findings.py gitleaks reports/gitleaks.sarif
    python3 infraops_findings.py semgrep  .semgrep.json
    python3 infraops_findings.py trivy    .trivy.json

Por que pelo log: os artifacts deste Forgejo nao funcionam (upload-artifact v3 E v4 respondem
"Artifact service responded with 500" -- achado da Fase 5 do CMCRM), entao o relatorio de um
scanner nao sai do job onde foi gerado. O log sai: ele e gravado em disco no proprio forge-01, e
o security-digest.py ja o lia para extrair a contagem. Este script troca a contagem por achado a
achado, sem mudar o canal.

SEGREDO NUNCA SAI DAQUI. Para gitleaks, o achado e "ha um segredo em arquivo:linha, regra X" e
nada mais: os campos Secret/Match/Snippet do relatorio sao descartados mesmo quando existem. O log
de CI e legivel por qualquer um com acesso ao repositorio -- um segredo redigido pelo scanner mas
reimpresso pelo relatorio continua vazado.

Nao falha o job: se o relatorio nao existe ou nao parseia, imprime um aviso e sai 0. O gate de
seguranca e o step do scanner, nao este script -- fazer o relatorio derrubar o job transformaria
um problema de observabilidade em um bloqueio de merge.
"""
import hashlib
import json
import os
import sys

MARCADOR = "::infraops-findings::v1"
# Teto de achados por scanner. Acima disso a lista e cortada e `truncated` avisa; `count` continua
# sendo o total real. Um scan com milhares de achados quase sempre e configuracao errada, e a
# linha do log tem limite pratico de tamanho.
MAX_FINDINGS = 300
MAX_PATH = 300
MAX_TITLE = 200


def chave(*partes):
    """Chave estavel de dedup: a identidade do achado entre dois scans.

    Deliberadamente NAO inclui versao de pacote nem commit: um pacote que sobe de versao e
    continua vulneravel e o MESMO achado, e recria-lo a cada bump apagaria o tempo ate a correcao
    -- justamente a metrica que o painel mostra.
    """
    bruto = "|".join("" if p is None else str(p) for p in partes)
    return hashlib.sha1(bruto.encode("utf-8", "replace")).hexdigest()[:16]


def corta(v, n):
    if v is None:
        return None
    v = str(v)
    return v if len(v) <= n else v[: n - 1] + "…"


def ler_json(caminho):
    with open(caminho, encoding="utf-8", errors="replace") as f:
        return json.load(f)


def de_gitleaks(doc):
    """Aceita SARIF (--report-format sarif) e o JSON nativo do gitleaks."""
    achados = []
    if isinstance(doc, dict) and "runs" in doc:  # SARIF
        for run in doc.get("runs") or []:
            for r in run.get("results") or []:
                rule = r.get("ruleId") or "gitleaks"
                loc = ((r.get("locations") or [{}])[0].get("physicalLocation") or {})
                path = (loc.get("artifactLocation") or {}).get("uri")
                line = (loc.get("region") or {}).get("startLine")
                achados.append({
                    "key": chave("gitleaks", rule, path, line),
                    "rule_id": rule,
                    "severity": "HIGH",  # segredo commitado nao tem meia severidade
                    "path": corta(path, MAX_PATH),
                    "line": line if isinstance(line, int) else None,
                    # Descricao da REGRA, nunca o valor detectado.
                    "title": corta(f"Possivel segredo: {rule}", MAX_TITLE),
                    "package": None,
                })
        return achados
    if isinstance(doc, list):  # JSON nativo: lista de leaks
        for r in doc:
            rule = r.get("RuleID") or r.get("rule_id") or "gitleaks"
            path = r.get("File") or r.get("file")
            line = r.get("StartLine") or r.get("line")
            achados.append({
                "key": chave("gitleaks", rule, path, line),
                "rule_id": rule,
                "severity": "HIGH",
                "path": corta(path, MAX_PATH),
                "line": line if isinstance(line, int) else None,
                "title": corta(f"Possivel segredo: {rule}", MAX_TITLE),
                "package": None,
            })
    return achados


def de_semgrep(doc):
    achados = []
    for r in doc.get("results") or []:
        rule = r.get("check_id") or "semgrep"
        path = r.get("path")
        line = (r.get("start") or {}).get("line")
        extra = r.get("extra") or {}
        sev = (extra.get("severity") or "WARNING").upper()
        msg = (extra.get("message") or rule).strip().splitlines()[0]
        achados.append({
            "key": chave("semgrep", rule, path, line),
            "rule_id": rule,
            "severity": sev,
            "path": corta(path, MAX_PATH),
            "line": line if isinstance(line, int) else None,
            "title": corta(msg, MAX_TITLE),
            "package": None,
        })
    return achados


def de_trivy(doc):
    achados = []
    for res in doc.get("Results") or []:
        alvo = res.get("Target")
        for v in res.get("Vulnerabilities") or []:
            cve = v.get("VulnerabilityID") or "?"
            pkg = v.get("PkgName")
            achados.append({
                "key": chave("trivy", cve, pkg, alvo),
                "rule_id": cve,
                "severity": (v.get("Severity") or "UNKNOWN").upper(),
                "path": corta(alvo, MAX_PATH),
                "line": None,
                "title": corta(
                    f"{cve} em {pkg} {v.get('InstalledVersion') or ''}".strip()
                    + (f" (corrigido em {v.get('FixedVersion')})" if v.get("FixedVersion") else " (sem correcao publicada)"),
                    MAX_TITLE,
                ),
                "package": corta(pkg, 120),
            })
    return achados


PARSERS = {"gitleaks": de_gitleaks, "semgrep": de_semgrep, "trivy": de_trivy}


def main():
    if len(sys.argv) < 3 or sys.argv[1] not in PARSERS:
        print(f"uso: {sys.argv[0]} <gitleaks|semgrep|trivy> <relatorio>", file=sys.stderr)
        return 2

    scanner, caminho = sys.argv[1], sys.argv[2]
    if not os.path.exists(caminho):
        # Ausencia de relatorio NAO vira "nenhum achado": o painel precisa continuar sabendo que
        # nao sabe. Sem a linha do marcador, a fonte reporta detail_level=count_only.
        print(f"[infraops] relatorio {caminho} nao existe — nenhum achado emitido (o painel tratara como nao detalhado)")
        return 0

    try:
        doc = ler_json(caminho)
        achados = PARSERS[scanner](doc)
    except Exception as e:  # noqa: BLE001 — relatorio quebrado nao pode derrubar o job de scan
        print(f"[infraops] falha ao ler {caminho}: {type(e).__name__}: {e}")
        return 0

    total = len(achados)
    truncado = total > MAX_FINDINGS
    payload = {
        "scanner": scanner,
        "count": total,
        "truncated": truncado,
        "findings": achados[:MAX_FINDINGS],
    }
    print(f"{MARCADOR} {json.dumps(payload, ensure_ascii=False, separators=(',', ':'))}")
    print(f"[infraops] {total} achado(s) de {scanner} publicados para o painel" + (" (lista cortada no teto)" if truncado else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
