"""Le .trivy.json e escreve um resumo em Markdown no $FORGEJO_STEP_SUMMARY."""
import json

d = json.load(open(".trivy.json"))
results = d.get("Results") or []
total = sum(len(r.get("Vulnerabilities") or []) for r in results)
print("## Trivy (HIGH/CRITICAL)\n")
print(f"**{total} vulnerabilidades** encontradas.\n")
if total:
    print("| pacote | CVE | severidade | corrigida em |")
    print("|---|---|---|---|")
for r in results:
    for v in (r.get("Vulnerabilities") or []):
        print(f"| {v.get('PkgName')} | {v.get('VulnerabilityID')} | {v.get('Severity')} | {v.get('FixedVersion') or '-'} |")
