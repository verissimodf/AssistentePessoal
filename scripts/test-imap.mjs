#!/usr/bin/env node
// Utilitário de diagnóstico e homologação para conectividade de E-mail (IMAP / SMTP).
// Permite validar credenciais de conta (App Password) e conectividade de rede com os servidores.
import dns from "node:dns/promises";
import tls from "node:tls";
import net from "node:net";

const DEFAULT_HOSTS = {
  gmail: { imap: "imap.gmail.com", imapPort: 993, smtp: "smtp.gmail.com", smtpPort: 587 },
  outlook: { imap: "outlook.office365.com", imapPort: 993, smtp: "outlook.office365.com", smtpPort: 587 },
};

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--user" && i + 1 < args.length) options.user = args[++i];
    else if (arg === "--pass" && i + 1 < args.length) options.pass = args[++i];
    else if (arg === "--type" && i + 1 < args.length) options.type = args[++i];
    else if (arg === "--imap-host" && i + 1 < args.length) options.imapHost = args[++i];
    else if (arg === "--imap-port" && i + 1 < args.length) options.imapPort = parseInt(args[++i], 10);
    else if (arg === "--smtp-host" && i + 1 < args.length) options.smtpHost = args[++i];
    else if (arg === "--smtp-port" && i + 1 < args.length) options.smtpPort = parseInt(args[++i], 10);
    else if (arg === "--help" || arg === "-h") options.help = true;
  }
  return options;
}

const opts = parseArgs();

if (opts.help) {
  console.log(`
Uso: node scripts/test-imap.mjs [opções]

Opções:
  --user <email>       Endereço de e-mail (ou JARVIS_MAIL_USER)
  --pass <senha>       Senha de aplicativo (App Password) (ou JARVIS_MAIL_PASSWORD)
  --type <gmail|outlook> Tipo de provedor (padrão: inferido pelo domínio)
  --imap-host <host>   Host IMAP personalizado
  --imap-port <porta>  Porta IMAP (padrão: 993)
  --smtp-host <host>   Host SMTP personalizado
  --smtp-port <porta>  Porta SMTP (padrão: 587)
  --dry-run            Valida apenas resolução DNS e portas sem autenticar
  --help, -h           Exibe esta mensagem de ajuda
`);
  process.exit(0);
}

const user = opts.user || process.env.JARVIS_MAIL_USER;
const pass = opts.pass || process.env.JARVIS_MAIL_PASSWORD;
let type = opts.type || (user && user.includes("outlook") ? "outlook" : "gmail");

const hosts = {
  imap: opts.imapHost || DEFAULT_HOSTS[type]?.imap || "imap.gmail.com",
  imapPort: opts.imapPort || DEFAULT_HOSTS[type]?.imapPort || 993,
  smtp: opts.smtpHost || DEFAULT_HOSTS[type]?.smtp || "smtp.gmail.com",
  smtpPort: opts.smtpPort || DEFAULT_HOSTS[type]?.smtpPort || 587,
};

console.log("=================================================");
console.log("🔍 Diagnóstico de Conectividade de E-mail J.A.R.V.I.S.");
console.log("=================================================");
console.log(`Provedor : ${type}`);
console.log(`IMAP     : ${hosts.imap}:${hosts.imapPort} (SSL/TLS)`);
console.log(`SMTP     : ${hosts.smtp}:${hosts.smtpPort} (STARTTLS)`);
console.log(`Usuário  : ${user ? user.replace(/(.).+(@.+)/, "$1***$2") : "[não informado - executando dry-run]"}`);
console.log("-------------------------------------------------");

async function checkDns(host) {
  process.stdout.write(`[DNS] Resolvendo ${host}... `);
  try {
    const addresses = await dns.lookup(host, { all: true });
    console.log(`OK (${addresses.map(a => a.address).join(", ")})`);
    return true;
  } catch (err) {
    console.log(`FALHA (${err.message})`);
    return false;
  }
}

async function checkTcp(host, port, timeoutMs = 5000) {
  process.stdout.write(`[TCP] Conectando a ${host}:${port}... `);
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port, timeout: timeoutMs });
    socket.on("connect", () => {
      console.log("OK (Porta aberta)");
      socket.destroy();
      resolve(true);
    });
    socket.on("timeout", () => {
      console.log(`FALHA (Timeout de ${timeoutMs}ms)`);
      socket.destroy();
      resolve(false);
    });
    socket.on("error", (err) => {
      console.log(`FALHA (${err.message})`);
      resolve(false);
    });
  });
}

async function checkTls(host, port, timeoutMs = 5000) {
  process.stdout.write(`[TLS] Handshake com ${host}:${port}... `);
  return new Promise((resolve) => {
    const socket = tls.connect({ host, port, servername: host, rejectUnauthorized: true, timeout: timeoutMs }, () => {
      console.log(`OK (Cifra: ${socket.getCipher()?.name}, Protocolo: ${socket.getProtocol()})`);
      socket.destroy();
      resolve(true);
    });
    socket.on("timeout", () => {
      console.log(`FALHA (Timeout de ${timeoutMs}ms)`);
      socket.destroy();
      resolve(false);
    });
    socket.on("error", (err) => {
      console.log(`FALHA (${err.message})`);
      resolve(false);
    });
  });
}

const dnsImapOk = await checkDns(hosts.imap);
const dnsSmtpOk = await checkDns(hosts.smtp);

if (!dnsImapOk || !dnsSmtpOk) {
  console.error("\n❌ Falha na resolução de DNS. Verifique sua conexão à internet.");
  process.exit(1);
}

const imapTlsOk = await checkTls(hosts.imap, hosts.imapPort);
const smtpTcpOk = await checkTcp(hosts.smtp, hosts.smtpPort);

if (!imapTlsOk || !smtpTcpOk) {
  console.error("\n❌ Falha na conexão de rede com os servidores de correio.");
  process.exit(1);
}

if (opts.dryRun || !user || !pass) {
  console.log("\n✅ Teste de infraestrutura e conectividade concluído com sucesso (dry-run).");
  console.log("Para testar login real, forneça --user <email> e --pass <senha_app> ou preencha as variáveis de ambiente.");
  process.exit(0);
}

// Teste de autenticação real com imapflow e nodemailer
console.log("\n🔐 Testando autenticação de conta...");

try {
  const { ImapFlow } = await import("imapflow");
  process.stdout.write("[IMAP] Autenticando e acessando INBOX... ");
  const client = new ImapFlow({
    host: hosts.imap,
    port: hosts.imapPort,
    secure: true,
    tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
    auth: { user, pass },
    logger: false,
  });

  await client.connect();
  const lock = await client.getMailboxLock("INBOX");
  const exists = client.mailbox?.exists ?? 0;
  lock.release();
  await client.logout();
  console.log(`OK (INBOX aberta, ${exists} mensagens encontradas)`);
} catch (err) {
  console.log(`FALHA (${err.message})`);
  console.error("Dica: no Gmail, use 'Senha de App' gerada em Minha Conta > Segurança > Verificação em duas etapas > Senhas de app.");
  process.exit(1);
}

try {
  const nodemailer = (await import("nodemailer")).default;
  process.stdout.write("[SMTP] Verificando credenciais de envio... ");
  const transport = nodemailer.createTransport({
    host: hosts.smtp,
    port: hosts.smtpPort,
    secure: false,
    requireTLS: true,
    tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
    auth: { user, pass },
  });

  await transport.verify();
  transport.close();
  console.log("OK (SMTP pronto para envio)");
} catch (err) {
  console.log(`FALHA (${err.message})`);
  process.exit(1);
}

console.log("\n🎉 Autenticação e conectividade IMAP/SMTP 100% HOMOLOGADAS!");
