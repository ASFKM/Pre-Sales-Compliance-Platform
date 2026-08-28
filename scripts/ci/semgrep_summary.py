"""Le .semgrep.json e escreve um resumo em Markdown no $FORGEJO_STEP_SUMMARY."""
import json
from collections import Counter

d = json.load(open(".semgrep.json"))
r = d["results"]
print("## Semgrep\n")
print(f"**{len(r)} findings**.\n")
sev = Counter(x["extra"]["severity"] for x in r)
print("Por severidade:", ", ".join(f"{k}: {v}" for k, v in sorted(sev.items())))
print()
rules = Counter(x["check_id"] for x in r)
print("| regra | ocorrências |")
print("|---|---|")
for rule, count in rules.most_common(15):
    print(f"| `{rule}` | {count} |")
