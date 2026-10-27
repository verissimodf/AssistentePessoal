// Metadados de build — a ÁRVORE EXATA de código que está a correr.
//
// O commit NUNCA é inferido em runtime (o processo roda sem git dentro do container e um `git log`
// do diretório atual mentiria sobre a imagem). Os valores vêm do build: `scripts/write-build-info.mjs`
// grava este ficheiro com `APP_VERSION`/`GIT_SHA`/`BUILD_TIME` (Dockerfile) e, fora de um build
// com ARGs, fica tudo em `unknown` — o painel mostra "Não registrado" em vez de adivinhar.
//
// Este módulo não abre rede, não faz I/O e não lança exceções: pode ser importado em qualquer
// ponto da arranque, inclusive no `/api/health` público.
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const UNKNOWN = "unknown";
// Data do build, não a hora do processo — é o que prova "quando foi isto construído".
let FILE = {
  appVersion: UNKNOWN,
  commit: UNKNOWN,
  buildTime: UNKNOWN,
  mode: UNKNOWN,
  schemaVersion: UNKNOWN,
  commitStatus: UNKNOWN,
};

// Localização espelha o resto do serviço: `JARVIS_DATA_DIR` → cwd (o container passa o data dir),
// com o diretório do módulo como último recurso. Sem ficheiro → tudo `unknown`, sem exceção.
const candidates = [
  resolve(process.env.JARVIS_DATA_DIR || process.cwd(), "server", "build-info.json"),
  fileURLToPath(new URL("./build-info.json", import.meta.url)),
];
for (const path of candidates) {
  if (!existsSync(path)) continue;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (parsed && typeof parsed === "object") {
      FILE = { ...FILE, ...parsed };
      break;
    }
  } catch {
    // JSON malformado: mantém `unknown` em vez de derrubar o arranque.
  }
}

const SENTINELS = new Set(["sem-build", "unknown"]);
const env = (name, fallback) => {
  const v = process.env[name];
  if (typeof v !== "string") return fallback;
  const clean = v.trim();
  // Marcadores de "não injetado" não podem sobrescrever um valor real do build-info.json.
  return clean && !SENTINELS.has(clean.toLowerCase()) ? clean : fallback;
};

// As variáveis de build ganham quando presentes; o ficheiro fica como base (build sem ENV).
export const APP_VERSION = env("APP_VERSION", FILE.appVersion);
export const GIT_COMMIT = env("GIT_SHA", FILE.commit);
export const BUILD_TIME = env("BUILD_TIME", FILE.buildTime);
export const BUILD_MODE = env("NODE_ENV", FILE.mode);
export const SCHEMA_VERSION = env("SCHEMA_VERSION", FILE.schemaVersion);
export const BUILD_COMMIT_STATUS = env("BUILD_COMMIT_STATUS", FILE.commitStatus);

const SHA = /^[0-9a-f]{7,40}$/i;
export const isKnownCommit = (sha) => typeof sha === "string" && SHA.test(sha);
/** Pode ser "unknown" (build sem metadados) — nunca uma versão presumida do branch. */
export const commitOrUnknown = () => (isKnownCommit(GIT_COMMIT) ? GIT_COMMIT : UNKNOWN);

/** Identidade de build para `/api/health` e diagnósticos. Só o que é conhecido é reportado:
 *  um campo `unknown` é mais honesto que um valor derivado do branch ou da tag da imagem. */
export const buildInfo = () => ({
  version: APP_VERSION,
  commit: commitOrUnknown(),
  buildTime: BUILD_TIME,
  mode: BUILD_MODE,
  // A imagem Docker pode levar a revisão como label OCI; o processo só a declara se o build a injetou.
  revision: isKnownCommit(GIT_COMMIT) ? GIT_COMMIT : UNKNOWN,
  // Esquema declarado no build (o runtime expõe também o user_version efetivo do banco).
  schemaVersion: /^\d+$/.test(String(SCHEMA_VERSION)) ? Number(SCHEMA_VERSION) : null,
  // "Registrado" | "Não registrado (local)" | "unknown" — nunca inferido do branch.
  commitStatus:
    typeof BUILD_COMMIT_STATUS === "string" && BUILD_COMMIT_STATUS.trim()
      ? BUILD_COMMIT_STATUS
      : UNKNOWN,
});
