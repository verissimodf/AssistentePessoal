// Phase 4 — transient drafts for human-approved sending (D9).
//
// An agent/bot must never send e-mail on its own. When a tool call asks to send, the server only
// prepares a DRAFT that a human reviews and confirms in the panel. The draft is the "temporary secure
// channel" for the body: it lives ONLY in this process's memory (a Map), is owner-bound, is
// single-use and expires quickly. It is NEVER written to the database, disk, audit or logs.
//
// Creating a draft is NOT an authorisation to send: the confirmation is a separate, explicit step by a
// verified human session (`POST /api/mail/drafts/:id/send` with `confirm: "ENVIAR"`).
import { randomUUID } from "node:crypto";

/**
 * In-memory draft store. `ttlMs` and `max` are provisional bounds (exposure/memory), configurable —
 * they are not a retention policy: nothing is persisted and everything is discarded on expiry or use.
 */
export function createDraftStore({ ttlMs = 10 * 60_000, max = 200, now = () => Date.now() } = {}) {
  const drafts = new Map(); // insertion-ordered: the oldest is evicted first

  const sweep = () => {
    const t = now();
    for (const [id, d] of drafts) if (d.expiresAt <= t) drafts.delete(id);
  };

  const owned = (id, adminId) => {
    const d = drafts.get(String(id));
    // Foreign and unknown drafts are indistinguishable.
    return d && adminId && d.adminId === adminId ? d : null;
  };

  return {
    put({ adminId, account, to, subject, body }) {
      sweep();
      while (drafts.size >= max) drafts.delete(drafts.keys().next().value);
      const at = now();
      const id = randomUUID();
      drafts.set(id, {
        id,
        adminId,
        account,
        to,
        subject,
        body,
        createdAt: at,
        expiresAt: at + ttlMs,
      });
      return { id, expiresAt: at + ttlMs };
    },
    get(id, adminId) {
      sweep();
      return owned(id, adminId);
    },
    /** Single-use: removes the draft. A second call returns null (no replay). */
    consume(id, adminId) {
      sweep();
      const d = owned(id, adminId);
      if (d) drafts.delete(String(id));
      return d;
    },
    size: () => drafts.size,
  };
}

let store = createDraftStore();

export function setDraftStore(next) {
  store = next ?? createDraftStore();
}

export const getDraftStore = () => store;
