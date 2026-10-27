import { test } from "node:test";
import assert from "node:assert/strict";
import { transcribeAudio } from "../server/stt.js";

const webm = () =>
  new File([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, ...new Array(32).fill(0)])], "clip.webm", {
    type: "audio/webm",
  });

test("local STT forwards bounded audio to private service and returns transcript only", async () => {
  let captured;
  const result = await transcribeAudio("admin-1", webm(), {
    env: { JARVIS_STT_URL: "http://stt:8080" },
    fetchFn: async (url, init) => {
      captured = { url, form: init.body };
      return { ok: true, json: async () => ({ text: "  Olá, Jarvis.  " }) };
    },
  });
  assert.equal(result.text, "Olá, Jarvis.");
  assert.equal(result.engine, "whisper.cpp-local");
  assert.equal(captured.url, "http://stt:8080/inference");
  assert.equal(captured.form.get("language"), "pt");
  assert.equal(captured.form.get("file").name, "speech.webm");
});

test("STT refuses invalid file signatures and does not call the service", async () => {
  let calls = 0;
  const file = new File([new Uint8Array(32).fill(0x41)], "x.webm", { type: "audio/webm" });
  await assert.rejects(
    transcribeAudio("admin-2", file, {
      fetchFn: async () => {
        calls++;
      },
    }),
    (e) => e.code === "audio_signature_invalid",
  );
  assert.equal(calls, 0);
});

test("STT provider failures are reduced to a stable local error", async () => {
  await assert.rejects(
    transcribeAudio("admin-3", webm(), {
      fetchFn: async () => ({
        ok: false,
        status: 500,
        text: async () => "sensitive upstream detail",
      }),
    }),
    (e) => e.code === "stt_unavailable" && !e.message.includes("sensitive"),
  );
});
