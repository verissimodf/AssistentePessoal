// Phase 3 — private local document store. First format: TXT (`text/plain`), no new dependency.
// Documents are UNTRUSTED data: they are stored and returned as plain text, never executed,
// never interpolated into shell/commands, and every read/write is scoped to the owner admin
// through the `ownership` table (same single source of truth as Phase 2).
import { writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { db, now, uid, audit, DATA_DIR } from "./db.js";
import { assignNew, owns, tx, dropOwnership } from "./ownership.js";

export const MAX_DOC_BYTES = Number(process.env.JARVIS_MAX_DOCUMENT) || 2_000_000; // 2 MB per document
export const SUPPORTED = { "text/plain": "txt" }; // Phase 3 starts with TXT; add formats one at a time.
const DOCS_DIR = join(DATA_DIR, "documents");

export class DocError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

const dirFor = (adminId) => { const d = join(DOCS_DIR, String(adminId)); mkdirSync(d, { recursive: true }); return d; };

/** Validate raw bytes: name, supported type, non-empty, size limit and no binary (NUL) content. */
export function validateDocument({ name, mime, buffer }) {
  if (typeof name !== "string" || !name.trim() || name.length > 200) throw new DocError(400, "invalid_name");
  if (typeof mime !== "string" || !SUPPORTED[mime]) throw new DocError(415, "unsupported_type");
  if (!buffer || buffer.length === 0) throw new DocError(400, "empty_document");
  if (buffer.length > MAX_DOC_BYTES) throw new DocError(413, "document_too_large");
  if (buffer.includes(0)) throw new DocError(400, "binary_not_allowed");
  return { text: buffer.toString("utf8"), ext: SUPPORTED[mime] };
}

/** Store a document for its owner. The file is written first; the row+ownership insert is atomic. */
export function saveDocument(ownerId, { name, mime, buffer }) {
  if (!ownerId) throw new DocError(403, "admin_session_required");
  const { text, ext } = validateDocument({ name, mime, buffer });
  const id = uid();
  const path = join(dirFor(ownerId), `${id}.${ext}`);
  writeFileSync(path, buffer, { mode: 0o600 });
  const at = now();
  try {
    tx(() => {
      db.prepare("INSERT INTO documents (id, name, mime, size, path, content_text, created_at) VALUES (?,?,?,?,?,?,?)")
        .run(id, name.trim(), mime, buffer.length, path, text, at);
      assignNew("document", id, ownerId);
    });
  } catch (e) { try { unlinkSync(path); } catch { /* best effort */ } throw e; }
  audit("document.saved", { admin: ownerId, id, name: name.trim(), size: buffer.length });
  return { id, name: name.trim(), mime, size: buffer.length, created_at: at };
}

const OWNED = `SELECT d.id, d.name, d.mime, d.size, d.created_at FROM documents d
  JOIN ownership o ON o.resource_type = 'document' AND o.resource_id = d.id AND o.owner_admin_id = ?`;

export const listDocuments = (ownerId) =>
  ownerId ? db.prepare(`${OWNED} ORDER BY d.created_at DESC`).all(ownerId) : [];

/** Full document only when the caller owns it; otherwise null (looks nonexistent). */
export function getDocument(ownerId, id) {
  if (!ownerId || !owns(ownerId, "document", id)) return null;
  return db.prepare("SELECT id, name, mime, size, path, content_text, created_at FROM documents WHERE id = ?").get(id) || null;
}

/** Keyword search over the owner's documents only; returns snippets, never foreign rows. */
export function searchDocuments(ownerId, query, limit = 10) {
  if (!ownerId) return [];
  const words = String(query || "").toLowerCase().split(/\W+/).filter((w) => w.length > 2);
  const rows = db.prepare(`SELECT d.id, d.name, d.content_text FROM documents d
    JOIN ownership o ON o.resource_type = 'document' AND o.resource_id = d.id AND o.owner_admin_id = ?`).all(ownerId);
  return rows
    .map((r) => {
      const hay = `${r.name} ${r.content_text}`.toLowerCase();
      const score = words.length ? words.filter((w) => hay.includes(w)).length / words.length : 0;
      return { id: r.id, name: r.name, score, snippet: r.content_text.slice(0, 240) };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function deleteDocument(ownerId, id) {
  if (!ownerId || !owns(ownerId, "document", id)) return { ok: false };
  const row = db.prepare("SELECT path FROM documents WHERE id = ?").get(id);
  tx(() => { db.prepare("DELETE FROM documents WHERE id = ?").run(id); dropOwnership("document", id); });
  if (row?.path) { try { unlinkSync(row.path); } catch { /* already gone */ } }
  audit("document.deleted", { admin: ownerId, id });
  return { ok: true };
}

export const documentCount = (ownerId) =>
  ownerId
    ? db.prepare(`SELECT COUNT(*) n FROM documents d
        JOIN ownership o ON o.resource_type = 'document' AND o.resource_id = d.id AND o.owner_admin_id = ?`).get(ownerId).n
    : 0;
