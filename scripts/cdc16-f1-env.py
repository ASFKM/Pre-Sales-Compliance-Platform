# Le o .env do checkout e emite "export K='v'" com shlex.quote.
#
# Existe por causa do acidente registrado no §10 da F0: `set -a; . .env` NAO
# exporta variavel cujo valor contenha `&` - o shell corta a linha ali e a
# aplicacao cai em outro banco sem erro nenhum. Aqui cada valor sai citado.
#
# Uso: eval "$(python3 /tmp/cdc16env.py [ARQUIVO] [--db OUTRO_BANCO] [--redis-db N])"
import re, shlex, sys, os
from urllib.parse import urlsplit, urlunsplit

args = sys.argv[1:]
arquivo = ".env"
db_alvo = None
redis_db = None
i = 0
while i < len(args):
    if args[i] == "--db":
        db_alvo = args[i + 1]; i += 2
    elif args[i] == "--redis-db":
        redis_db = args[i + 1]; i += 2
    else:
        arquivo = args[i]; i += 1

vals = {}
for linha in open(arquivo, encoding="utf-8"):
    linha = linha.strip()
    if not linha or linha.startswith("#") or "=" not in linha:
        continue
    k, v = linha.split("=", 1)
    k = k.strip()
    v = v.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
        v = v[1:-1]
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", k):
        continue
    vals[k] = v

if "DATABASE_URL" in vals:
    # A URL original, antes de qualquer troca de banco: e' com ela que o script
    # de preparacao le (SELECT, so leitura) a identidade da instalacao viva.
    vals["LIVE_DATABASE_URL"] = vals["DATABASE_URL"]

if db_alvo and "DATABASE_URL" in vals:
    p = urlsplit(vals["DATABASE_URL"])
    vals["DATABASE_URL"] = urlunsplit((p.scheme, p.netloc, "/" + db_alvo, p.query, p.fragment))
if redis_db is not None and "REDIS_URL" in vals:
    p = urlsplit(vals["REDIS_URL"])
    vals["REDIS_URL"] = urlunsplit((p.scheme, p.netloc, "/" + str(redis_db), p.query, p.fragment))

for k, v in vals.items():
    print(f"export {k}={shlex.quote(v)}")
