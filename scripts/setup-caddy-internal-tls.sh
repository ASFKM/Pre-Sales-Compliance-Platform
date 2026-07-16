#!/usr/bin/env bash
# Installs Caddy and configures it as a reverse proxy in front of the app (which stays bound to
# 127.0.0.1 only, unchanged - see server.ts's comment on the Zero Trust rollout), using Caddy's
# built-in internal CA to terminate TLS for installations with no public domain pointed at them
# (Let's Encrypt's ACME challenge needs one; this doesn't). Traffic on the LAN is encrypted either
# way - the only difference from a real CA-signed cert is that browsers warn until the internal
# CA's root is trusted on client machines (this script prints where to get it).
#
# Usage: bash scripts/setup-caddy-internal-tls.sh [IP-ou-hostname-do-servidor]
set -euo pipefail

ADDRESS="${1:-}"
if [[ -z "$ADDRESS" ]]; then
  ADDRESS=$(hostname -I 2>/dev/null | awk '{print $1}')
  read -rp "Endereço em que o Caddy vai aceitar conexões [${ADDRESS}]: " ADDRESS_INPUT
  ADDRESS="${ADDRESS_INPUT:-$ADDRESS}"
fi
if [[ -z "$ADDRESS" ]]; then
  echo "Não consegui detectar um endereço e nenhum foi informado. Uso: bash $0 <ip-ou-hostname>" >&2
  exit 1
fi

if ! command -v caddy >/dev/null 2>&1; then
  echo "[1/3] Instalando Caddy..."
  sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl >/dev/null
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  sudo apt-get update -qq
  sudo apt-get install -y caddy
else
  echo "[1/3] Caddy já instalado."
fi

echo "[2/3] Escrevendo /etc/caddy/Caddyfile (TLS via CA interna, proxy pra 127.0.0.1:3000)..."
sudo tee /etc/caddy/Caddyfile > /dev/null <<EOF
https://${ADDRESS} {
	tls internal
	reverse_proxy 127.0.0.1:3000
}

http://${ADDRESS} {
	redir https://${ADDRESS}{uri} permanent
}
EOF

echo "[3/3] Recarregando o Caddy..."
sudo systemctl enable caddy >/dev/null 2>&1 || true
sudo systemctl restart caddy
sleep 2
sudo systemctl status caddy --no-pager | head -8

CA_ROOT="/var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt"
echo ""
echo "=== Concluído. Acesse: https://${ADDRESS} ==="
echo "O certificado é de uma CA interna do Caddy - navegadores vão avisar 'não confiável' até"
echo "confiarem nessa CA. Raiz da CA (pra instalar nas máquinas clientes, se quiser eliminar o"
echo "aviso): sudo cat ${CA_ROOT}"
