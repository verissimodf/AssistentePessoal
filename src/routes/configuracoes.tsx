import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/AppShell";
import { ConnectionTest } from "@/components/ConnectionTest";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, bridgeUrl, DEFAULT_BRIDGE, DEFAULT_SETTINGS, loadSettings, ping, saveSettings, type Settings } from "@/lib/bridge";
import { AGENT_INTEGRATIONS, COMMS, PROVIDERS } from "@/lib/catalog";
import { createClapDetector, thresholdFromSensitivity } from "@/lib/clap";
import { LANGS, useI18n, type Lang } from "@/lib/i18n";
import { SecurityPanel } from "@/components/SecurityPanel";
import { DiagnosticoPanel } from "@/components/DiagnosticoPanel";
import { ProvenancePanel } from "@/components/ProvenancePanel";
import { useAuthText } from "@/components/AuthGate";

export const Route = createFileRoute("/configuracoes")({
  head: () => ({
    meta: [
      { title: "Configurações — Jarvis" },
      { name: "description", content: "Provedores de IA, integrações, voz, ativação e idioma do Jarvis." },
      { property: "og:title", content: "Configurações — Jarvis" },
      { property: "og:description", content: "Painel administrativo do Jarvis local." },
    ],
  }),
  component: SettingsPage,
});

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="flex flex-col gap-1"><span className="hud-label">{label}</span>{children}</label>;
}

function SettingsPage() {
  const { t, setLang } = useI18n();
  const a = useAuthText();
  const [s, setS] = useState<Settings | null>(DEFAULT_SETTINGS);
  const [bridge, setBridge] = useState(DEFAULT_BRIDGE);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { loadSettings().then(setS); setBridge(bridgeUrl()); }, []);
  if (!s) return null;

  const set = (section: string, key: string, value: unknown) => setS({ ...s, [section]: { ...s[section], [key]: value } });
  const setNested = (section: string, id: string, key: string, value: unknown) =>
    setS({ ...s, [section]: { ...s[section], [id]: { ...(s[section]?.[id] || {}), [key]: value } } });
  const save = async () => {
    localStorage.setItem("jarvis.bridge", bridge);
    await saveSettings(s);
    setLang(s.general.language as Lang);
    toast.success(t("saved"));
  };
  const testProvider = async (id: string) => {
    if (!(await ping())) { toast.info(t("demo_hint")); return; }
    await saveSettings(s);
    try { const r = await api<{ ok: boolean; detail: string }>(`/api/providers/${id}/test`, { method: "POST" }); r.ok ? toast.success(r.detail) : toast.error(r.detail); }
    catch (e) { toast.error(String((e as Error).message)); }
  };
  const uploadVoice = async (f: File) => {
    if (!(await ping())) { toast.info(t("demo_hint")); return; }
    const fd = new FormData();
    fd.append("file", f);
    fd.append("engine", s.voice.cloneEngine || "elevenlabs");
    try { const r = await api<{ voiceId: string }>("/api/voice/clone", { method: "POST", body: fd }); setS({ ...s, voice: { ...s.voice, clonedVoiceId: r.voiceId, clonedName: f.name } }); toast.success(f.name); }
    catch (e) { toast.error(String((e as Error).message)); }
  };
  const calibrate = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const ctx = new AudioContext(); const an = ctx.createAnalyser(); an.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(an);
    const det = createClapDetector({ threshold: thresholdFromSensitivity(s.voice.sensitivity) });
    const buf = new Float32Array(512); const end = performance.now() + 8000;
    const loop = () => {
      an.getFloatTimeDomainData(buf);
      let p = 0; for (const v of buf) p = Math.max(p, Math.abs(v));
      if (det.feed(p, performance.now())) { toast.success(t("clap_detected")); }
      if (performance.now() < end) requestAnimationFrame(loop); else { stream.getTracks().forEach((x) => x.stop()); ctx.close(); }
    };
    toast(t("calibrate") + "… 8s"); loop();
  };

  const inputCls = "rounded-md border border-input bg-secondary px-2 py-2 text-sm";
  return (
    <div className="h-screen overflow-y-auto p-6 md:p-10">
      <PageHeader title={t("settings_title")} sub={t("local_only")}><Button onClick={save}>{t("save")}</Button></PageHeader>
      <Tabs defaultValue="providers">
        <TabsList className="mb-6 flex-wrap">
          <TabsTrigger value="providers">{t("s_providers")}</TabsTrigger>
          <TabsTrigger value="agents">{t("s_agents")}</TabsTrigger>
          <TabsTrigger value="comms">{t("s_comms")}</TabsTrigger>
          <TabsTrigger value="voice">{t("s_voice")}</TabsTrigger>
          <TabsTrigger value="general">{t("s_general")}</TabsTrigger>
          <TabsTrigger value="security">{a("security")}</TabsTrigger>
          <TabsTrigger value="diagnostics">{t("s_diagnostics")}</TabsTrigger>
          <TabsTrigger value="provenance">{t("s_provenance")}</TabsTrigger>
        </TabsList>

        <TabsContent value="security"><SecurityPanel /></TabsContent>

        <TabsContent value="diagnostics"><DiagnosticoPanel /></TabsContent>

        {/* P0.2 — proveniência efetiva: origem de cada valor, sem expor segredos. */}
        <TabsContent value="provenance"><ProvenancePanel /></TabsContent>

        <TabsContent value="providers" className="grid gap-3 md:grid-cols-2">
          {PROVIDERS.map((p) => {
            const v = s.providers?.[p.id] || {};
            return (
              <div key={p.id} className="hud-panel space-y-3 p-4">
                <div className="flex items-center justify-between">
                  <span className="font-display">{p.name}</span>
                  <Switch checked={!!v.enabled} onCheckedChange={(c) => setNested("providers", p.id, "enabled", c)} />
                </div>
                <Field label={t("base_url")}><Input value={v.baseUrl ?? p.baseUrl} onChange={(e) => setNested("providers", p.id, "baseUrl", e.target.value)} /></Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label={t("api_key")}><Input type="password" placeholder={v.hasKey ? "••••••••" : ""} value={v.apiKey || ""} onChange={(e) => setNested("providers", p.id, "apiKey", e.target.value)} /></Field>
                  <Field label={t("default_model")}><Input value={v.model ?? p.model} onChange={(e) => setNested("providers", p.id, "model", e.target.value)} /></Field>
                </div>
                <Button size="sm" variant="outline" onClick={() => testProvider(p.id)}>{t("test")}</Button>
              </div>
            );
          })}
        </TabsContent>

        <TabsContent value="agents" className="grid gap-3 md:grid-cols-2">
          {AGENT_INTEGRATIONS.map((a) => {
            const v = s.integrations?.[a.id] || {};
            return (
              <div key={a.id} className="hud-panel space-y-3 p-4">
                <div className="flex items-center justify-between">
                  <span className="font-display">{a.name} <span className="hud-label">{a.kind}</span></span>
                  <Switch checked={!!v.enabled} onCheckedChange={(c) => setNested("integrations", a.id, "enabled", c)} />
                </div>
                <Field label={a.kind === "http" ? t("base_url") : t("command")}>
                  <Input className="font-mono" value={v.command ?? a.command} onChange={(e) => setNested("integrations", a.id, "command", e.target.value)} />
                </Field>
                {a.kind === "http" && <Field label={t("api_key")}><Input type="password" value={v.apiKey || ""} onChange={(e) => setNested("integrations", a.id, "apiKey", e.target.value)} /></Field>}
              </div>
            );
          })}
        </TabsContent>

        <TabsContent value="comms" className="grid gap-3 md:grid-cols-2">
          {COMMS.map((c) => {
            const v = s.comms?.[c.id] || {};
            return (
              <div key={c.id} className="hud-panel space-y-3 p-4">
                <div className="flex items-center justify-between">
                  <span className="font-display">{c.name}</span>
                  <Switch checked={!!v.enabled} onCheckedChange={(x) => setNested("comms", c.id, "enabled", x)} />
                </div>
                {c.fields.map((f) => (
                  <Field key={f} label={f}><Input type={/token|password/i.test(f) ? "password" : "text"} value={v[f] || ""} onChange={(e) => setNested("comms", c.id, f, e.target.value)} /></Field>
                ))}
                {(c.fields as readonly string[]).includes("appPassword") && (
                  <ConnectionTest account={c.id} />
                )}
              </div>
            );
          })}
        </TabsContent>

        <TabsContent value="voice" className="grid gap-3 md:grid-cols-2">
          <div className="hud-panel space-y-4 p-4">
            <div className="font-display">{t("wake_methods")}</div>
            {(["clap", "word", "hotkey", "ptt"] as const).map((k) => (
              <div key={k} className="flex items-center justify-between text-sm">
                <span>{t(`wake_${k}` as const)}{k === "word" ? ` — “${s.general.agentName}”` : k === "hotkey" ? ` — ${s.voice.hotkey}` : ""}</span>
                <Switch checked={!!s.voice.wake?.[k]} onCheckedChange={(c) => set("voice", "wake", { ...s.voice.wake, [k]: c })} />
              </div>
            ))}
            <Field label={`${t("sensitivity")}: ${s.voice.sensitivity}`}>
              <input type="range" min={1} max={10} value={s.voice.sensitivity} onChange={(e) => set("voice", "sensitivity", Number(e.target.value))} className="accent-primary" />
            </Field>
            <Button size="sm" variant="outline" onClick={calibrate}>{t("calibrate")}</Button>
          </div>
          <div className="hud-panel space-y-4 p-4">
            <Field label={t("tts_engine")}>
              <select className={inputCls} value={s.voice.tts} onChange={(e) => set("voice", "tts", e.target.value)}>
                <option value="browser">Navegador / sistema</option>
                <option value="kokoro">Kokoro (local)</option>
                <option value="xtts">XTTS-v2 voz clonada (local)</option>
                <option value="elevenlabs">ElevenLabs</option>
              </select>
            </Field>
            <Field label={t("voice_clone")}>
              <select className={inputCls} value={s.voice.cloneEngine || "xtts"} onChange={(e) => set("voice", "cloneEngine", e.target.value)}>
                <option value="xtts">XTTS-v2 (local, sem nuvem)</option>
                <option value="elevenlabs">ElevenLabs Instant Voice Clone</option>
              </select>
            </Field>
            <input ref={fileRef} type="file" accept=".wav,.mp3,.ogg,.flac,.m4a,audio/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadVoice(e.target.files[0])} />
            <Button variant="outline" onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4" />{t("upload_voice")}</Button>
            <p className="text-xs text-muted-foreground">{t("voice_hint")}</p>
            {s.voice.clonedName && <p className="hud-label">✓ {s.voice.clonedName}</p>}
          </div>
        </TabsContent>

        <TabsContent value="general" className="grid gap-3 md:grid-cols-2">
          <div className="hud-panel space-y-4 p-4">
            <Field label={t("agent_name")}><Input value={s.general.agentName} onChange={(e) => set("general", "agentName", e.target.value)} /></Field>
            <Field label={t("language")}>
              <select className={inputCls} value={s.general.language} onChange={(e) => set("general", "language", e.target.value)}>
                {LANGS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
              </select>
            </Field>
            <Field label={t("bridge_url")}><Input value={bridge} onChange={(e) => setBridge(e.target.value)} /></Field>
          </div>
          <div className="hud-panel space-y-4 p-4">
            <div className="flex items-center justify-between"><span className="font-display">{t("host_actions")}</span>
              <Switch checked={!!s.host.enabled} onCheckedChange={(c) => set("host", "enabled", c)} /></div>
            <Field label={t("allowlist")}><Input className="font-mono" value={s.host.allowlist} onChange={(e) => set("host", "allowlist", e.target.value)} /></Field>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
