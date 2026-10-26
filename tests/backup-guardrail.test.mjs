// Guarda-corpo do backup: o script precisa estar marcado como executável no Git
// (regressão anterior causou `203/EXEC` no timer systemd), ser um script bash
// estrito, usar cópia consistente (VACUUM INTO) e gerar checksums que cubram
// todos os artefatos incluídos no backup (banco, chave mestra e vozes),
// sem referenciar o próprio manifesto.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const scriptUrl = new URL("../deploy/backup-data.sh", import.meta.url);
const script = readFileSync(scriptUrl, "utf8").replace(/\r\n/g, "\n");

test("deploy/backup-data.sh está versionado com modo Git 100755", () => {
  let out;
  try {
    out = execFileSync("git", ["ls-files", "-s", "--", "deploy/backup-data.sh"], {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
    });
  } catch {
    // Sem git disponível (arquivo empacotado sem repositório): nada a verificar aqui.
    return;
  }
  const row = out
    .split("\n")
    .find((l) => l.trim().endsWith("deploy/backup-data.sh"));
  assert.ok(row, "backup-data.sh deve estar versionado");
  assert.equal(row.trim().split(/\s+/)[0], "100755", "modo Git deve ser 100755 (sem isso o timer systemd falha com 203/EXEC)");
});

test("backup-data.sh é bash estrito", () => {
  assert.match(script, /^#!\/usr\/bin\/env bash\n/);
  assert.match(script, /set -euo pipefail/);
});

test("backup usa cópia consistente (VACUUM INTO) e valida integridade", () => {
  assert.match(script, /VACUUM INTO/);
  assert.match(script, /PRAGMA integrity_check/);
  // nunca copia -wal/-shm do banco vivo de forma inconsistente
  assert.doesNotMatch(script, /cp\b[^\n]*jarvis\.db[^\n]*-wal/);
});

test("checksums cobrem banco, chave e vozes, sem autorreferência", () => {
  assert.match(script, /sha256sum jarvis\.db master\.key > SHA256SUMS\.txt/);
  assert.match(script, /find voices -type f/);
  assert.match(script, /sha256sum >> SHA256SUMS\.txt/);
  // o manifesto não se inclui a si mesmo
  assert.doesNotMatch(script, /sha256sum[^\n]*SHA256SUMS\.txt[^\n]*>>/);
});

test("cópia externa é opcional (opt-in) e fail-soft", () => {
  assert.match(script, /JARVIS_BACKUP_REMOTE/);
  // sem remote configurado, nada é enviado e o script termina com sucesso do backup local
  const pos = script.indexOf("JARVIS_BACKUP_REMOTE");
  assert.ok(pos > 0, "hook externo deve existir");
  // a falha da cópia externa não deve matar o script (aviso, não exit 1)
  assert.doesNotMatch(script, /rclone copy[^\n]*&&\s*exit 1/);
});

test("backup não imprime segredos nem conteúdo do master.key", () => {
  assert.doesNotMatch(script, /cat[^\n]*master\.key/);
  assert.doesNotMatch(script, /cat[^\n]*\.env/);
});
