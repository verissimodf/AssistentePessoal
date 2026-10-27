import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  AdapterRequestError,
  MAX_TTS_BODY_BYTES,
  MAX_TTS_TEXT_LENGTH,
  prepareXttsRequest,
  readJsonBody,
} from "../scripts/voice-adapter-core.mjs";

const common = { xttsUrl: "http://xtts-service:8000", defaultSpeaker: "jarvis-ptbr" };

test("ponte usa voz pré-cadastrada com formulário compatível com xtts-service", async () => {
  const request = await prepareXttsRequest({ text: "Olá", lang: "pt-BR" }, common);
  assert.equal(request.url.href, "http://xtts-service:8000/voice/speak");
  assert.equal(request.init.method, "POST");
  assert.equal(request.init.body.get("text"), "Olá");
  assert.equal(request.init.body.get("speaker"), "jarvis-ptbr");
  assert.equal(request.init.body.get("language"), "pt");
});

test("amostra clonada do diretório local é enviada ao contrato /voice/clone", async () => {
  const root = await mkdtemp(join(tmpdir(), "jarvis-voice-adapter-"));
  try {
    const voices = join(root, "voices");
    await mkdir(voices);
    const sample = join(voices, "voice-123.wav");
    await writeFile(sample, Buffer.from("sample-audio"));
    const request = await prepareXttsRequest(
      { text: "Teste", lang: "pt-BR", speaker_wav: sample },
      { ...common, dataDir: root },
    );
    assert.equal(request.url.href, "http://xtts-service:8000/voice/clone");
    assert.equal(request.init.body.get("text"), "Teste");
    assert.equal(request.init.body.get("language"), "pt");
    assert.equal(request.init.body.get("speaker_label"), "voice-123");
    assert.equal(request.init.body.get("speaker_audio").size, 12);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("amostra não pode escapar do diretório de vozes nem por symlink", async () => {
  const root = await mkdtemp(join(tmpdir(), "jarvis-voice-adapter-path-"));
  try {
    const voices = join(root, "voices");
    await mkdir(voices);
    const outside = join(root, "outside.wav");
    await writeFile(outside, Buffer.from("audio"));
    const link = join(voices, "link.wav");
    await symlink(outside, link);
    for (const path of [outside, link, `${voices}/../outside.wav`]) {
      await assert.rejects(
        prepareXttsRequest({ text: "Teste", speaker_wav: path }, { ...common, dataDir: root }),
        (error) => error instanceof AdapterRequestError && error.code === "invalid_voice_sample",
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("valida texto, idioma e nome da voz antes de chamar o serviço", async () => {
  await assert.rejects(
    prepareXttsRequest({ text: "  " }, common),
    (error) => error instanceof AdapterRequestError && error.code === "text_required",
  );
  await assert.rejects(
    prepareXttsRequest({ text: "x".repeat(MAX_TTS_TEXT_LENGTH + 1) }, common),
    (error) => error instanceof AdapterRequestError && error.status === 413,
  );
  await assert.rejects(
    prepareXttsRequest({ text: "Oi", lang: "../../" }, common),
    (error) => error instanceof AdapterRequestError && error.code === "invalid_language",
  );
  await assert.rejects(
    prepareXttsRequest({ text: "Oi", speaker: "../jarvis" }, common),
    (error) => error instanceof AdapterRequestError && error.code === "invalid_speaker",
  );
});

test("corpo JSON do adaptador tem limite de tamanho", async () => {
  async function* oversized() {
    yield Buffer.alloc(MAX_TTS_BODY_BYTES + 1, 0x20);
  }
  await assert.rejects(
    readJsonBody({ headers: {}, [Symbol.asyncIterator]: () => oversized() }),
    (error) => error instanceof AdapterRequestError && error.status === 413,
  );
});
