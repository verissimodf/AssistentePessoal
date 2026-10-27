// Relé TCP para expor o Assistente Pessoal na rede privada Tailscale SEM abrir
// o serviço na LAN e SEM exigir sudo. Escuta apenas no IP Tailscale do host e
// encaminha para o destino configurado (por padrão o loopback, onde o serviço
// rodava; após a migração para container, o IP do container na rede Docker).
//
//   <TAILNET_IP>:7777 -> <TAILNET_TARGET_HOST>:7777  (API)
//   <TAILNET_IP>:8090 -> <TAILNET_TARGET_HOST>:8090  (painel)
//
// Variáveis (todas opcionais; os padrões preservam o comportamento anterior):
//   TAILNET_IP           IP de escuta (padrão: detecta via `tailscale ip -4`)
//   TAILNET_TARGET_HOST  destino do encaminhamento (padrão: 127.0.0.1)
//   TAILNET_MAPS         pares listen:target separados por vírgula
//                        (padrão: 7777:7777,8090:8090)
import net from "node:net";
import { execSync } from "node:child_process";

function detectTailnetIp() {
  if (process.env.TAILNET_IP) return process.env.TAILNET_IP;
  try {
    return execSync("tailscale ip -4", { encoding: "utf8" }).trim().split("\n")[0];
  } catch {
    return "";
  }
}

const IP = detectTailnetIp();
const TARGET_HOST = process.env.TAILNET_TARGET_HOST || "127.0.0.1";
const MAPS = (process.env.TAILNET_MAPS || "7777:7777,8090:8090")
  .split(",")
  .map((pair) => pair.split(":").map((n) => Number(n.trim())))
  .filter(([listen, target]) => Number.isInteger(listen) && Number.isInteger(target));

if (!IP) {
  console.warn("[tailnet-proxy] IP Tailscale não detectado; relé desativado.");
  process.exit(0);
}

for (const [listenPort, targetPort] of MAPS) {
  const server = net.createServer((client) => {
    const upstream = net.connect(targetPort, TARGET_HOST);
    client.pipe(upstream);
    upstream.pipe(client);
    const kill = () => {
      client.destroy();
      upstream.destroy();
    };
    client.on("error", kill);
    upstream.on("error", kill);
  });
  server.on("error", (e) => console.warn(`[tailnet-proxy] ${IP}:${listenPort} -> ${e.message}`));
  server.listen(listenPort, IP, () =>
    console.log(`[tailnet-proxy] ${IP}:${listenPort} -> ${TARGET_HOST}:${targetPort}`),
  );
}
