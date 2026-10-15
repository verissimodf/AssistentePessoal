// Phase 4 — transient drafts for human-approved sending (D9).
//
// An agent/bot must never send e-mail on its own. When a tool call asks to send, the server only
// prepares a DRAFT that a human reviews and confirms in the panel. The draft is the "temporary secure
// channel" for the body: it lives ONLY in this process's memory (a Map), is owner-bound, is
// single-use and expires quickly. It is NEVER written to the database, disk, audit or logs.
//
// Creating a draft is NOT an authorisation to send: the confirmation is a separate, explicit step by a
// verified human session (`POST /api/mail/drafts/:id/send` with `confirm: "ENVIAR"`).
//
// Lifecycle: pending → (sending → sent | failed) | cancelled | expired.
// The body is held ONLY while `pending`: every terminal transition clears it. `sending` is the short
// in-flight window after the body was handed to the transport (kept so a crash cannot allow a replay).
import { randomUUID } from "node:crypto";

/** Exposed states. `sending` is the brief in-flight window; the others are terminal. */
export const DRAFT_STATES = ["pending", "sending", "sent", "failed", "cancelled", "expired"];
const TERMINAL = new Set(["sent", "failed", "cancelled", "expired"]);

/**
 * In-memory draft store. `ttlMs`, `outcomeTtlMs` and `max` are provisional bounds (exposure/memory),
 * configurable — they are not a retention policy: nothing is persisted and every body is discarded on
 * expiry or on the first terminal transition.
 */
export function createDraftStore({
  ttlMs = 10 * 60_000,
  outcomeTtlMs = 5 * 60_000,
  max = 200,
  now = () => Date.now(),
} = {}) {
  const drafts = new Map(); // insertion-ordered: the oldest is evicted first

  const finish = (d, state, at) => {
    d.body = null; // never keep the body past a terminal state
    d.state = state;
    d.expiresAt = at + outcomeTtlMs;
  };

  const sweep = () => {
    const t = now();
    for (const [id, d] of drafts) {
      if (d.state === "pending" && d.expiresAt <= t) finish(d, "expired", t);
      else if (d.state === "sending" && d.expiresAt <= t)
        finish(d, "failed", t); // abandoned in-flight
      else if (TERMINAL.has(d.state) && d.expiresAt <= t) drafts.delete(id);
    }
  };

  const owned = (id, adminId) => {
    const d = drafts.get(String(id));
    // Foreign and unknown drafts are indistinguishable.
    return d && adminId && d.adminId === adminId ? d : null;
  };

  const meta = (d) => ({
    id: d.id,
    account: d.account,
    to: d.to,
    subject: d.subject,
    state: d.state,
    createdAt: d.createdAt,
    expiresAt: d.expiresAt,
  });

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
        state: "pending",
        createdAt: at,
        expiresAt: at + ttlMs,
      });
      return { id, expiresAt: at + ttlMs };
    },
    /** Metadata of the admin's own drafts (never the body). */
    list(adminId) {
      sweep();
      return [...drafts.values()].filter((d) => adminId && d.adminId === adminId).map(meta);
    },
    /** Full draft for review: the body is present only while `pending`. */
    get(id, adminId) {
      sweep();
      const d = owned(id, adminId);
      return d ? { ...meta(d), body: d.state === "pending" ? d.body : null } : null;
    },
    /**
     * Single-use claim: clears the body and moves pending → sending, returning the outgoing payload.
     * A second claim (or a claim after cancel/expiry) returns null — no replay.
     */
    claim(id, adminId) {
      sweep();
      const d = owned(id, adminId);
      if (!d || d.state !== "pending") return null;
      const outgoing = { account: d.account, to: d.to, subject: d.subject, body: d.body };
      d.body = null;
      d.state = "sending";
      d.expiresAt = now() + ttlMs; // bound the in-flight window
      return outgoing;
    },
    /** Record the outcome of a claim. Only a `sending` draft can be settled. */
    settle(id, adminId, state) {
      if (!["sent", "failed"].includes(state)) return false;
      sweep();
      const d = owned(id, adminId);
      if (!d || d.state !== "sending") return false;
      finish(d, state, now());
      return true;
    },
    /** Discard a pending draft. Terminal drafts cannot be cancelled. */
    cancel(id, adminId) {
      sweep();
      const d = owned(id, adminId);
      if (!d || d.state !== "pending") return false;
      finish(d, "cancelled", now());
      return true;
    },
    size: () => drafts.size,
  };
}

let store = createDraftStore();

export function setDraftStore(next) {
  store = next ?? createDraftStore();
}

export const getDraftStore = () => store;
