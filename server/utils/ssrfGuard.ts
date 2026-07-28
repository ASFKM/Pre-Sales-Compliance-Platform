import dns from "dns";
import net from "net";

// AUD-008 (auditoria de segurança, 2026-07-19): URLs configuráveis por admin (fleet_manager_url,
// base_url de provedor de IA customizado) só eram validadas como "é uma URL http(s) válida" -
// nada impedia apontar pra um IP interno, loopback, ou endpoint de metadata de nuvem (ex.:
// https://169.254.169.254/...). Essas ações já exigem permissão de admin (barra bem mais alta que
// um SSRF anônimo), mas isso não é motivo pra confiar cegamente no destino - um admin comprometido
// ou malicioso ainda poderia usar isso pra sondar/alcançar rede interna a partir deste servidor.
//
// Limitação conhecida, documentada em vez de escondida: isto valida o IP resolvido NO MOMENTO DO
// CADASTRO, não a cada chamada real - um DNS rebinding (o hostname resolve pra um IP público
// agora, pra um IP interno depois) não é coberto. Fechar isso por completo exigiria fixar o IP
// resolvido no próprio cliente HTTP usado nas chamadas de IA (agente customizado com lookup
// fixado), uma mudança bem maior que uma validação de input - fora do escopo desta correção.
//
// Duas categorias, checadas separadamente: "sempre bloqueado" (loopback, link-local/metadata de
// nuvem, reservado/multicast) nunca é um destino legítimo pra NADA que este código valida, nem
// mesmo com allowPrivateNetwork - já "RFC1918/CGNAT" (rede privada "normal", tipo a LAN de um
// escritório) pode ser legítimo dependendo do caso de uso (ver allowPrivateNetwork abaixo).
function isAlwaysBlockedIp(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 4) {
    const parts = ip.split(".").map(Number);
    const [a, b] = parts;
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local, inclui metadata de nuvem (169.254.169.254)
    if (a === 0) return true; // "esta rede"
    if (a === 192 && b === 0 && parts[2] === 0) return true; // IETF protocol assignments
    if (a === 192 && b === 0 && parts[2] === 2) return true; // TEST-NET-1
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
    if (a === 198 && b === 51 && parts[2] === 100) return true; // TEST-NET-2
    if (a === 203 && b === 0 && parts[2] === 113) return true; // TEST-NET-3
    if (a >= 224) return true; // multicast (224-239) + reservado (240-255)
    return false;
  }
  if (version === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1") return true; // loopback
    if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true; // fe80::/10 (link-local)
    if (lower.startsWith("::ffff:")) {
      const v4 = lower.slice(7);
      return net.isIP(v4) === 4 ? isAlwaysBlockedIp(v4) : true; // IPv4-mapped - checa o IPv4 embutido, ou bloqueia se não conseguir parsear
    }
    return false;
  }
  return true; // não é um IP reconhecível - trata como suspeito, não como seguro
}

function isRfc1918OrCgnat(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 4) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 10) return true; // RFC1918
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
    if (a === 192 && b === 168) return true; // RFC1918
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT (100.64.0.0/10) - também usado por Tailscale
    return false;
  }
  if (version === 6) {
    const lower = ip.toLowerCase();
    return lower.startsWith("fc") || lower.startsWith("fd"); // fc00::/7 (unique local)
  }
  return false;
}

// allowPrivateNetwork: descoberto testando com dado real, não hipotético - o fleet_manager_url
// real desta instalação é um IP RFC1918 (192.168.x.x), porque o Fleet Manager está na MESMA LAN,
// não na internet pública. Bloquear rede privada incondicionalmente travaria a própria
// configuração legítima já em produção. Mesmo com allowPrivateNetwork, loopback e link-local/
// metadata de nuvem continuam bloqueados incondicionalmente (isAlwaysBlockedIp) - nunca fazem
// sentido pra nenhum dos dois casos de uso, só RFC1918/CGNAT (rede local "normal") é liberado.
// Para provedor de IA customizado (uso padrão, allowPrivateNetwork=false), nem RFC1918 é
// permitido - toda API de IA real é pública, rede privada nunca é um destino legítimo ali.
export async function assertPublicHttpsUrl(rawUrl: string, options: { allowPrivateNetwork?: boolean } = {}): Promise<void> {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:") {
    throw new Error("A URL base deve usar https.");
  }

  // url.hostname para um IPv6 literal vem com colchetes ("[::1]") - net.isIP não reconhece
  // isso como IP, então cai indevidamente no ramo de resolução DNS. Remove os colchetes antes de
  // checar, senão um IPv6 loopback/reservado com literal na URL só é bloqueado por falha de
  // resolução (efeito final igual, mensagem de erro enganosa).
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  let addresses: string[];
  if (net.isIP(hostname)) {
    addresses = [hostname];
  } else {
    try {
      // lookup (não resolve) - mesmo mecanismo de resolução que uma conexão real usaria (respeita
      // /etc/hosts e a config de DNS do sistema), cobrindo IPv4 e IPv6 numa chamada só.
      const results = await dns.promises.lookup(hostname, { all: true });
      addresses = results.map((r) => r.address);
    } catch {
      throw new Error(`Não foi possível resolver o host "${hostname}".`);
    }
  }

  for (const addr of addresses) {
    if (isAlwaysBlockedIp(addr)) {
      throw new Error(`O host "${hostname}" resolve para um endereço interno/reservado (${addr}) - não permitido.`);
    }
    if (!options.allowPrivateNetwork && isRfc1918OrCgnat(addr)) {
      throw new Error(`O host "${hostname}" resolve para um endereço interno/reservado (${addr}) - não permitido.`);
    }
  }
}
