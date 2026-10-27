// Roadmap v1.1 — private local document store with PDF/DOCX ingestion and Hybrid RAG.
// Documents are UNTRUSTED data: stored as extracted text, never executed, never interpolated into
// shell/commands, and every read/write/chunk/embedding is strictly scoped to the owner admin
// through the `ownership` table and the `admin_id` column.
import { writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import zlib from "node:zlib";
import { db, now, uid, audit, DATA_DIR } from "./db.js";
import { assignNew, owns, tx, dropOwnership } from "./ownership.js";
import { embed, cosine } from "./llm.js";

export const MAX_TXT_BYTES = Number(process.env.JARVIS_MAX_DOCUMENT) || 2_000_000; // 2 MB per text doc
export const MAX_BINARY_BYTES = Number(process.env.JARVIS_MAX_DOCUMENT_BINARY) || 10_000_000; // 10 MB for PDF/DOCX
export const MAX_DOC_BYTES = MAX_TXT_BYTES; // Backward compatibility alias
export const MAX_CHUNKS_PER_DOC = 500;
export const CHUNK_TARGET_SIZE = 800;
export const CHUNK_OVERLAP = 150;

export const SUPPORTED = {
  "text/plain": "txt",
  "text/markdown": "md",
  "text/x-markdown": "md",
  "text/csv": "csv",
  "application/json": "json",
  "application/pdf": "pdf",
  "application/x-pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/docx": "docx",
};

const DOCS_DIR = join(DATA_DIR, "documents");

export class DocError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

const dirFor = (adminId) => { const d = join(DOCS_DIR, String(adminId)); mkdirSync(d, { recursive: true }); return d; };

// ============================================================================
// PDF & DOCX Native Extractors (Zero external compilation / Zero native deps)
// ============================================================================

function unescapePdfString(s) {
  return s
    .replace(/\\([0-7]{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\b/g, "\b")
    .replace(/\\f/g, "\f")
    .replace(/\\([\\()])/g, "$1");
}

function decodeHexPdfString(hex) {
  const clean = hex.replace(/\s+/g, "");
  if (clean.length % 2 !== 0) return "";
  const buf = Buffer.from(clean, "hex");
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return buf.subarray(2).swap16().toString("utf16le");
  }
  if (buf.length >= 2 && buf[0] === 0x00) {
    return buf.swap16().toString("utf16le");
  }
  return buf.toString("latin1");
}

export function extractPdfText(buffer) {
  if (!buffer || buffer.length < 5) throw new DocError(400, "corrupted_pdf");
  if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new DocError(400, "invalid_pdf_signature");
  }

  const textPieces = [];
  const str = buffer.toString("binary");
  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match;

  try {
    while ((match = streamRegex.exec(str)) !== null) {
      let data = Buffer.from(match[1], "binary");
      try {
        data = zlib.inflateSync(data);
      } catch {
        try {
          data = zlib.inflateRawSync(data);
        } catch {
          // Uncompressed or raw stream
        }
      }
      const content = data.toString("utf8");

      // Extract text in Tj operators: (text) Tj, (text) ', (text) "
      const tjRegex = /\(([^)\\]*(?:\\.[^)\\]*)*)\)\s*['"Tj]/g;
      let m;
      while ((m = tjRegex.exec(content)) !== null) {
        textPieces.push(unescapePdfString(m[1]));
      }

      // Extract text in TJ array operators: [ (text1) 20 (text2) ] TJ
      const arrayTjRegex = /\[([\s\S]*?)\]\s*TJ/g;
      while ((m = arrayTjRegex.exec(content)) !== null) {
        const inner = m[1];
        const partRegex = /\(([^)\\]*(?:\\.[^)\\]*)*)\)/g;
        let p;
        while ((p = partRegex.exec(inner)) !== null) {
          textPieces.push(unescapePdfString(p[1]));
        }
        const hexPartRegex = /<([0-9a-fA-F\s]+)>/g;
        while ((p = hexPartRegex.exec(inner)) !== null) {
          textPieces.push(decodeHexPdfString(p[1]));
        }
      }

      // Extract hex string Tj: <00480065...> Tj
      const hexTjRegex = /<([0-9a-fA-F\s]+)>\s*['"Tj]/g;
      while ((m = hexTjRegex.exec(content)) !== null) {
        textPieces.push(decodeHexPdfString(m[1]));
      }
    }
  } catch (err) {
    throw new DocError(400, "corrupted_pdf");
  }

  const result = textPieces
    .filter(Boolean)
    .join(" ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!result) {
    throw new DocError(422, "pdf_no_text_layer");
  }

  return result;
}

export function extractDocxText(buffer) {
  if (!buffer || buffer.length < 4) throw new DocError(400, "corrupted_docx");
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b || buffer[2] !== 0x03 || buffer[3] !== 0x04) {
    throw new DocError(400, "invalid_docx_signature");
  }

  let documentXml = null;

  try {
    // 1. Scan local file headers
    let offset = 0;
    while (offset + 30 <= buffer.length) {
      const sig = buffer.readUInt32LE(offset);
      if (sig !== 0x04034b50) break;

      const compMethod = buffer.readUInt16LE(offset + 8);
      let compSize = buffer.readUInt32LE(offset + 18);
      const fnLen = buffer.readUInt16LE(offset + 26);
      const extraLen = buffer.readUInt16LE(offset + 28);
      const filename = buffer.toString("utf8", offset + 30, offset + 30 + fnLen);
      const dataStart = offset + 30 + fnLen + extraLen;

      const flags = buffer.readUInt16LE(offset + 6);
      if ((flags & 8) !== 0 && compSize === 0) {
        let nextHeader = dataStart;
        while (nextHeader + 4 <= buffer.length) {
          const nextSig = buffer.readUInt32LE(nextHeader);
          if (nextSig === 0x04034b50 || nextSig === 0x02014b50 || nextSig === 0x08074b50) break;
          nextHeader++;
        }
        compSize = nextHeader - dataStart;
      }

      if (filename === "word/document.xml") {
        const compressedData = buffer.subarray(dataStart, dataStart + compSize);
        documentXml = compMethod === 8
          ? zlib.inflateRawSync(compressedData).toString("utf8")
          : compressedData.toString("utf8");
        break;
      }

      offset = dataStart + compSize;
    }

    // 2. Fallback to Central Directory if needed
    if (!documentXml) {
      let eocdOffset = buffer.length - 22;
      while (eocdOffset >= 0 && buffer.readUInt32LE(eocdOffset) !== 0x06054b50) eocdOffset--;
      if (eocdOffset >= 0) {
        const cdOffset = buffer.readUInt32LE(eocdOffset + 16);
        const cdSize = buffer.readUInt32LE(eocdOffset + 12);
        let cdPos = cdOffset;
        while (cdPos < cdOffset + cdSize && cdPos + 46 <= buffer.length) {
          if (buffer.readUInt32LE(cdPos) !== 0x02014b50) break;
          const compMethod = buffer.readUInt16LE(cdPos + 10);
          const compSize = buffer.readUInt32LE(cdPos + 20);
          const fnLen = buffer.readUInt16LE(cdPos + 28);
          const extraLen = buffer.readUInt16LE(cdPos + 30);
          const commentLen = buffer.readUInt16LE(cdPos + 32);
          const localOffset = buffer.readUInt32LE(cdPos + 42);
          const fn = buffer.toString("utf8", cdPos + 46, cdPos + 46 + fnLen);

          if (fn === "word/document.xml") {
            const lFnLen = buffer.readUInt16LE(localOffset + 26);
            const lExtraLen = buffer.readUInt16LE(localOffset + 28);
            const dataStart = localOffset + 30 + lFnLen + lExtraLen;
            const compressedData = buffer.subarray(dataStart, dataStart + compSize);
            documentXml = compMethod === 8
              ? zlib.inflateRawSync(compressedData).toString("utf8")
              : compressedData.toString("utf8");
            break;
          }
          cdPos += 46 + fnLen + extraLen + commentLen;
        }
      }
    }
  } catch {
    throw new DocError(400, "corrupted_docx");
  }

  if (!documentXml) throw new DocError(422, "docx_no_text_content");

  const paragraphs = [];
  const pRegex = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/gi;
  let pMatch;
  while ((pMatch = pRegex.exec(documentXml)) !== null) {
    const pContent = pMatch[1];
    const textParts = [];
    const tRegex = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/gi;
    let tMatch;
    while ((tMatch = tRegex.exec(pContent)) !== null) {
      textParts.push(tMatch[1]);
    }
    const paraText = textParts.join("").trim();
    if (paraText) paragraphs.push(paraText);
  }

  return paragraphs
    .join("\n\n")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

// ============================================================================
// Chunking Engine with Overlap and Natural Boundary Preservation
// ============================================================================

export function chunkDocumentText(text, { targetSize = CHUNK_TARGET_SIZE, overlap = CHUNK_OVERLAP, maxChunks = MAX_CHUNKS_PER_DOC } = {}) {
  const clean = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!clean) return [];

  if (clean.length <= targetSize) {
    return [{
      chunk_index: 0,
      content: clean,
      token_estimate: Math.max(1, Math.ceil(clean.length / 4)),
    }];
  }

  const rawParagraphs = clean.split(/\n{2,}/);
  const units = [];

  for (const para of rawParagraphs) {
    const p = para.trim();
    if (!p) continue;
    if (p.length <= targetSize) {
      units.push(p);
    } else {
      const sentences = p.split(/(?<=[.?!;\n])\s+/);
      for (const s of sentences) {
        const trimmed = s.trim();
        if (!trimmed) continue;
        if (trimmed.length <= targetSize) {
          units.push(trimmed);
        } else {
          for (let i = 0; i < trimmed.length; i += targetSize - overlap) {
            units.push(trimmed.slice(i, i + targetSize).trim());
          }
        }
      }
    }
  }

  const chunks = [];
  let currentChunk = "";
  let chunkIndex = 0;

  for (const unit of units) {
    if (chunks.length >= maxChunks) break;

    if (!currentChunk) {
      currentChunk = unit;
    } else if (currentChunk.length + unit.length + 2 <= targetSize) {
      currentChunk += "\n\n" + unit;
    } else {
      chunks.push({
        chunk_index: chunkIndex++,
        content: currentChunk,
        token_estimate: Math.max(1, Math.ceil(currentChunk.length / 4)),
      });
      if (chunks.length >= maxChunks) break;

      const overlapText = currentChunk.slice(Math.max(0, currentChunk.length - overlap));
      currentChunk = overlapText + "\n\n" + unit;
    }
  }

  if (currentChunk && chunks.length < maxChunks) {
    chunks.push({
      chunk_index: chunkIndex,
      content: currentChunk,
      token_estimate: Math.max(1, Math.ceil(currentChunk.length / 4)),
    });
  }

  return chunks;
}

// ============================================================================
// Document Validation and Ingestion
// ============================================================================

export function validateDocument({ name, mime, buffer }) {
  if (typeof name !== "string" || !name.trim() || name.length > 200) throw new DocError(400, "invalid_name");
  if (typeof mime !== "string" || !SUPPORTED[mime]) throw new DocError(415, "unsupported_type");
  if (!buffer || buffer.length === 0) throw new DocError(400, "empty_document");

  const ext = SUPPORTED[mime];
  const isBinary = ext === "pdf" || ext === "docx";
  const maxAllowed = isBinary ? MAX_BINARY_BYTES : MAX_TXT_BYTES;

  if (buffer.length > maxAllowed) throw new DocError(413, "document_too_large");

  let text = "";
  if (ext === "pdf") {
    text = extractPdfText(buffer);
    if (!text || !text.trim()) throw new DocError(422, "pdf_no_text_layer");
  } else if (ext === "docx") {
    text = extractDocxText(buffer);
    if (!text || !text.trim()) throw new DocError(422, "docx_no_text_content");
  } else {
    if (buffer.includes(0)) throw new DocError(400, "binary_not_allowed");
    text = buffer.toString("utf8");
    if (!text.trim()) throw new DocError(400, "empty_document");
  }

  return { text, ext };
}

/** Store a document and index its chunks for hybrid RAG. Atomic row + chunks insert. */
export async function saveDocument(ownerId, { name, mime, buffer }, { embedFn = embed } = {}) {
  if (!ownerId) throw new DocError(403, "admin_session_required");
  const { text, ext } = validateDocument({ name, mime, buffer });
  const id = uid();
  const path = join(dirFor(ownerId), `${id}.${ext}`);
  writeFileSync(path, buffer, { mode: 0o600 });
  const at = now();

  const chunks = chunkDocumentText(text);

  let anyEmbedding = false;
  const chunkRows = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    let emb = null;
    let model = null;
    try {
      const res = await embedFn(chunk.content, ownerId);
      if (Array.isArray(res) && res.length > 0) {
        emb = res;
        model = "embeddings";
        anyEmbedding = true;
      }
    } catch {
      emb = null;
      model = null;
    }
    chunkRows.push({
      id: uid(),
      document_id: id,
      admin_id: ownerId,
      chunk_index: chunk.chunk_index,
      content: chunk.content,
      token_estimate: chunk.token_estimate,
      embedding_json: emb ? JSON.stringify(emb) : null,
      embedding_model: model,
    });
  }

  const ragStatus = anyEmbedding ? "hybrid" : "lexical_only";

  try {
    tx(() => {
      db.prepare(
        "INSERT INTO documents (id, name, mime, size, path, content_text, created_at, chunk_count, rag_status) VALUES (?,?,?,?,?,?,?,?,?)"
      ).run(id, name.trim(), mime, buffer.length, path, text, at, chunks.length, ragStatus);

      assignNew("document", id, ownerId);

      const insChunk = db.prepare(
        "INSERT INTO document_chunks (id, document_id, admin_id, chunk_index, content, token_estimate, embedding_json, embedding_model, created_at) VALUES (?,?,?,?,?,?,?,?,?)"
      );
      for (const c of chunkRows) {
        insChunk.run(c.id, c.document_id, c.admin_id, c.chunk_index, c.content, c.token_estimate, c.embedding_json, c.embedding_model, at);
      }
    });
  } catch (e) {
    try { unlinkSync(path); } catch { /* best effort */ }
    throw e;
  }

  audit("document.saved", { admin: ownerId, id, name: name.trim(), size: buffer.length });
  return {
    id,
    name: name.trim(),
    mime,
    size: buffer.length,
    created_at: at,
    chunk_count: chunks.length,
    rag_status: ragStatus,
  };
}

const OWNED = `SELECT d.id, d.name, d.mime, d.size, d.created_at, d.chunk_count, d.rag_status FROM documents d
  JOIN ownership o ON o.resource_type = 'document' AND o.resource_id = d.id AND o.owner_admin_id = ?`;

export const listDocuments = (ownerId) =>
  ownerId ? db.prepare(`${OWNED} ORDER BY d.created_at DESC`).all(ownerId) : [];

export function getDocument(ownerId, id) {
  if (!ownerId || !owns(ownerId, "document", id)) return null;
  return db.prepare("SELECT id, name, mime, size, path, content_text, created_at, chunk_count, rag_status FROM documents WHERE id = ?").get(id) || null;
}

export function listDocumentChunks(ownerId, documentId) {
  if (!ownerId || !owns(ownerId, "document", documentId)) return [];
  return db.prepare(
    "SELECT id, document_id, chunk_index, content, token_estimate, (embedding_json IS NOT NULL) AS has_embedding, embedding_model, created_at FROM document_chunks WHERE document_id = ? AND admin_id = ? ORDER BY chunk_index ASC"
  ).all(documentId, ownerId);
}

// ============================================================================
// Hybrid Semantic & Lexical RAG Search
// ============================================================================

export async function searchDocuments(ownerId, query, limit = 10, { embedFn = embed, cosineFn = cosine } = {}) {
  if (!ownerId) return [];
  const qClean = String(query || "").trim();
  if (!qClean) return [];

  const words = qClean.toLowerCase().split(/\W+/).filter((w) => w.length > 2);

  let queryEmbedding = null;
  let embeddingFailure = null;
  try {
    const qRes = await embedFn(qClean, ownerId);
    if (Array.isArray(qRes) && qRes.length > 0) queryEmbedding = qRes;
    else embeddingFailure = "embedding_unavailable";
  } catch {
    queryEmbedding = null;
    embeddingFailure = "embedding_error";
  }

  // Retrieve chunks scoped strictly to the owner admin
  const chunks = db.prepare(`
    SELECT c.id, c.document_id, c.chunk_index, c.content, c.embedding_json, c.embedding_model, d.name AS document_name
    FROM document_chunks c
    JOIN documents d ON d.id = c.document_id
    JOIN ownership o ON o.resource_type = 'document' AND o.resource_id = d.id AND o.owner_admin_id = ?
    WHERE c.admin_id = ?
  `).all(ownerId, ownerId);

  // Fallback to documents content_text if no chunks exist (e.g. legacy documents prior to v12)
  if (!chunks.length) {
    const legacy = db.prepare(`
      SELECT d.id, d.name, d.content_text FROM documents d
      JOIN ownership o ON o.resource_type = 'document' AND o.resource_id = d.id AND o.owner_admin_id = ?
    `).all(ownerId);

    return legacy
      .map((r) => {
        const hay = `${r.name} ${r.content_text}`.toLowerCase();
        const score = words.length ? words.filter((w) => hay.includes(w)).length / words.length : 0;
        return {
          id: r.id,
          document_id: r.id,
          chunk_id: null,
          filename: r.name,
          name: r.name,
          chunk_index: 0,
          score,
          search_mode: "lexical",
          fallback_reason: "legacy_document_text",
          snippet: r.content_text.slice(0, 300),
          content: r.content_text,
        };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  const scored = [];

  for (const c of chunks) {
    const hay = `${c.document_name} ${c.content}`.toLowerCase();
    const termMatches = words.filter((w) => hay.includes(w)).length;
    const lexicalScore = words.length ? termMatches / words.length : 0;

    let semanticScore = null;
    if (queryEmbedding && c.embedding_json) {
      try {
        const chunkEmb = JSON.parse(c.embedding_json);
        if (Array.isArray(chunkEmb)) {
          const sim = cosineFn(queryEmbedding, chunkEmb);
          semanticScore = Math.max(0, sim);
        }
      } catch {
        semanticScore = null;
      }
    }

    let finalScore = 0;
    let mode = "lexical";

    if (semanticScore !== null) {
      // Hybrid Formula: 70% Semantic + 30% Lexical
      finalScore = (0.70 * semanticScore) + (0.30 * lexicalScore);
      mode = lexicalScore > 0 ? "hybrid" : "semantic";
    } else {
      // Graceful fallback to 100% Lexical
      finalScore = lexicalScore;
      mode = "lexical";
    }

    if (finalScore > 0.01) {
      scored.push({
        id: c.document_id,
        document_id: c.document_id,
        chunk_id: c.id,
        filename: c.document_name,
        name: c.document_name,
        chunk_index: c.chunk_index,
        score: Number(finalScore.toFixed(4)),
        search_mode: mode,
        ...(mode === "lexical" ? { fallback_reason: embeddingFailure || (c.embedding_json ? "invalid_embedding" : "document_without_embedding") } : {}),
        snippet: c.content.slice(0, 300),
        content: c.content,
      });
    }
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function deleteDocument(ownerId, id) {
  if (!ownerId || !owns(ownerId, "document", id)) return { ok: false };
  const row = db.prepare("SELECT path FROM documents WHERE id = ?").get(id);
  tx(() => {
    db.prepare("DELETE FROM document_chunks WHERE document_id = ?").run(id);
    db.prepare("DELETE FROM documents WHERE id = ?").run(id);
    dropOwnership("document", id);
  });
  if (row?.path) { try { unlinkSync(row.path); } catch { /* already gone */ } }
  audit("document.deleted", { admin: ownerId, id });
  return { ok: true };
}

export const documentCount = (ownerId) =>
  ownerId
    ? db.prepare(`SELECT COUNT(*) n FROM documents d
        JOIN ownership o ON o.resource_type = 'document' AND o.resource_id = d.id AND o.owner_admin_id = ?`).get(ownerId).n
    : 0;

/**
 * Reindexação Vetorial Sob Demanda (Roadmap v1.3.0).
 * Regenera embeddings para os chunks de um documento cujo provedor de embeddings
 * esteve indisponível na ingestão inicial, promovendo de lexical_only para hybrid.
 */
export async function reindexDocument(ownerId, id, { embedFn = embed } = {}) {
  if (!ownerId || !owns(ownerId, "document", id)) return null;

  const doc = db.prepare("SELECT id, name, rag_status FROM documents WHERE id = ?").get(id);
  if (!doc) return null;

  const chunks = db.prepare(
    "SELECT id, content, embedding_json FROM document_chunks WHERE document_id = ? AND admin_id = ? ORDER BY chunk_index ASC"
  ).all(id, ownerId);

  if (!chunks.length) {
    return { ok: false, reason: "no_chunks_found", id, rag_status: doc.rag_status, vectorizedChunks: 0 };
  }

  let vectorizedCount = 0;
  const updates = [];

  for (const c of chunks) {
    let emb = null;
    try {
      const res = await embedFn(c.content, ownerId);
      if (Array.isArray(res) && res.length > 0) {
        emb = res;
      }
    } catch {
      emb = null;
    }

    if (emb) {
      updates.push({
        id: c.id,
        embedding_json: JSON.stringify(emb),
        embedding_model: "embeddings",
      });
      vectorizedCount++;
    }
  }

  // Se nenhum vetor pôde ser gerado (provedor continua indisponível)
  if (vectorizedCount === 0) {
    return {
      ok: false,
      reason: "embedding_provider_unavailable",
      id,
      rag_status: doc.rag_status || "lexical_only",
      vectorizedChunks: 0,
    };
  }

  tx(() => {
    const updChunk = db.prepare(
      "UPDATE document_chunks SET embedding_json = ?, embedding_model = ? WHERE id = ?"
    );
    for (const u of updates) {
      updChunk.run(u.embedding_json, u.embedding_model, u.id);
    }
    db.prepare("UPDATE documents SET rag_status = 'hybrid' WHERE id = ?").run(id);
  });

  audit("document.reindexed", { admin: ownerId, id, vectorizedChunks: vectorizedCount });

  return {
    ok: true,
    id,
    rag_status: "hybrid",
    vectorizedChunks: vectorizedCount,
  };
}

/**
 * Auto-Healer RAG para Documentos lexical_only (Roadmap v1.4.0).
 * Vetoriza em lote os documentos pendentes de um administrador que foram ingeridos offline.
 * Possui circuit-breaker imediato caso o provedor de embeddings esteja offline.
 */
export async function reindexPendingDocuments(adminId, { limit = 5, embedFn } = {}) {
  if (!adminId) return { ok: false, reason: "unauthorized", processed: 0, upgraded: 0, ids: [] };

  const maxLimit = Math.max(1, Number(limit) || 5);
  const pendingDocs = db.prepare(`
    SELECT d.id, d.name, d.rag_status
    FROM documents d
    JOIN ownership o ON o.resource_type = 'document' AND o.resource_id = d.id AND o.owner_admin_id = ?
    WHERE d.rag_status IN ('lexical_only', 'lexical')
    ORDER BY d.created_at ASC
    LIMIT ?
  `).all(adminId, maxLimit);

  if (!pendingDocs.length) {
    return { ok: true, processed: 0, upgraded: 0, ids: [] };
  }

  let processed = 0;
  let upgraded = 0;
  const upgradedIds = [];

  for (let i = 0; i < pendingDocs.length; i++) {
    const doc = pendingDocs[i];
    const res = await reindexDocument(adminId, doc.id, { embedFn });

    if (res && res.reason === "embedding_provider_unavailable") {
      audit("documents.reindex_pending_halted", {
        admin: adminId,
        reason: "embedding_provider_unavailable",
        processed,
      });
      return {
        ok: false,
        reason: "embedding_provider_unavailable",
        processed: processed,
        upgraded,
        ids: upgradedIds,
      };
    }

    processed++;
    if (res && res.ok) {
      upgraded++;
      upgradedIds.push(doc.id);
    }
  }

  audit("documents.reindex_pending_completed", {
    admin: adminId,
    processed,
    upgraded,
    count: upgradedIds.length,
  });

  return {
    ok: true,
    processed,
    upgraded,
    ids: upgradedIds,
  };
}


