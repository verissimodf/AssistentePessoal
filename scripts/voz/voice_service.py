"""Serviço de voz local opcional do Jarvis (127.0.0.1:7778).

- XTTS-v2 (Coqui): fala com voz clonada a partir de uma amostra .wav/.mp3 (sem nuvem).
- Kokoro: voz padrão leve (pf_dora para pt-BR, como no projeto original).

Instalação: scripts/instalar-voz.cmd (Windows) ou scripts/instalar-voz.sh (Linux).
"""
import io
import json
from http.server import BaseHTTPRequestHandler, HTTPServer

import soundfile as sf

_xtts = None
_kokoro = {}

KOKORO_VOICES = {"pt": ("p", "pf_dora"), "en": ("a", "af_heart"), "es": ("e", "ef_dora")}


def xtts():
    global _xtts
    if _xtts is None:
        from TTS.api import TTS  # coqui-tts
        _xtts = TTS("tts_models/multilingual/multi-dataset/xtts_v2")
    return _xtts


def kokoro(lang):
    code, voice = KOKORO_VOICES.get(lang, KOKORO_VOICES["en"])
    if code not in _kokoro:
        from kokoro import KPipeline
        _kokoro[code] = KPipeline(lang_code=code)
    return _kokoro[code], voice


def synth(text, lang, engine, speaker_wav):
    buf = io.BytesIO()
    if engine == "xtts" and speaker_wav:
        wav = xtts().tts(text=text, speaker_wav=speaker_wav, language=lang)
        sf.write(buf, wav, 24000, format="WAV")
    else:
        import numpy as np
        pipe, voice = kokoro(lang)
        audio = np.concatenate([a for _, _, a in pipe(text, voice=voice)])
        sf.write(buf, audio, 24000, format="WAV")
    return buf.getvalue()


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path in ("/health", "/"):
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"status":"ok","service":"jarvis-voice"}')
            return
        self.send_error(404)

    def do_POST(self):
        if self.path != "/tts":
            self.send_error(404)
            return
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        try:
            data = synth(body["text"], body.get("lang", "pt"), body.get("engine", "kokoro"), body.get("speaker_wav"))
            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.end_headers()
            self.wfile.write(data)
        except Exception as e:  # noqa: BLE001
            self.send_response(500)
            self.end_headers()
            self.wfile.write(str(e).encode())


if __name__ == "__main__":
    print("Serviço de voz do Jarvis em http://127.0.0.1:7778")
    HTTPServer(("127.0.0.1", 7778), Handler).serve_forever()
