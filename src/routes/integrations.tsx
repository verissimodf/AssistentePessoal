import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Calendar,
  Cable,
  Check,
  Clock,
  Copy,
  Plug,
  Plus,
  Radar,
  RefreshCw,
  Webhook,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  activateIfIntegration,
  createIfCalendarAccount,
  createIfIntegration,
  createIfProducer,
  disableIfIntegration,
  getPrControls,
  listIfCalendarAccounts,
  listIfCalendarConflicts,
  listIfCalendarEvents,
  listIfCatalog,
  listIfEvents,
  listIfIntegrations,
  listIfProducers,
  listPrRules,
  ping,
  savePrControls,
  syncIfCalendarAccount,
  testIfIntegration,
  type IfCalendarAccount,
  type IfCalendarEvent,
  type IfCatalogEntry,
  type IfConflict,
  type IfEvent,
  type IfIntegration,
  type IfProducer,
  type IfSyncResult,
  type PrControls,
  type PrRule,
} from "@/lib/bridge";
import { useI18n } from "@/lib/i18n";
import {
  IF_CALENDAR_ADAPTERS,
  IF_SIGNATURE_WINDOW_MS,
  IF_WEBHOOK_ADAPTERS,
  ifAllowedEventTypesFromText,
  ifErrorCode,
  ifErrorCodeLabel,
  ifEventStatusBadge,
  formatIfSignatureWindow,
  ifIngressPath,
  ifIntegrationStatusBadge,
  ifSyncSummary,
  ifTrustBadge,
  validateIfCalendarAccountForm,
  validateIfIntegrationForm,
  validateIfProducerForm,
  validateIfTimezone,
} from "@/lib/integrations-ui";

export const Route = createFileRoute("/integrations")({
  head: () => ({
    meta: [
      { title: "Integration Studio — Jarvis" },
      {
        name: "description",
        content:
          "Integrações locais: webhooks autenticados por HMAC-SHA256, sincronização de calendários com provider abstrato, Event Inspector com proveniência e inteligência temporal com timezone IANA.",
      },
      { property: "og:title", content: "Integration Studio — Jarvis" },
      {
        property: "og:description",
        content:
          "O segredo do produtor aparece uma única vez; providers de teste são sempre marcados; indisponibilidade do provider real é explícita — nunca simulada.",
      },
    ],
  }),
  component: IntegrationsPage,
});

const selectCls = "w-full rounded-md border border-input bg-secondary p-2 text-sm";

export function IntegrationsPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState("integrations");

  // dados carregados do serviço local (null = carregando/indisponível)
  const [catalog, setCatalog] = useState<IfCatalogEntry[] | null>(null);
  const [integrations, setIntegrations] = useState<IfIntegration[] | null>(null);
  const [events, setEvents] = useState<IfEvent[] | null>(null);
  const [accounts, setAccounts] = useState<IfCalendarAccount[] | null>(null);
  const [rules, setRules] = useState<PrRule[] | null>(null);
  const [controls, setControls] = useState<PrControls | null>(null);
  const [busy, setBusy] = useState(false);

  // formulário de integração
  const [formOpen, setFormOpen] = useState(false);
  const [formKind, setFormKind] = useState<"webhook" | "calendar">("webhook");
  const [formAdapter, setFormAdapter] = useState<string>("webhook");
  const [formName, setFormName] = useState("");
  const [formConfig, setFormConfig] = useState("{}");
  const [formError, setFormError] = useState<string | null>(null);

  // produtores por integração (expansão inline) + segredo exibido UMA vez
  const [openIntId, setOpenIntId] = useState<string | null>(null);
  const [producers, setProducers] = useState<Record<string, IfProducer[]>>({});
  const [producerName, setProducerName] = useState("");
  const [producerTypes, setProducerTypes] = useState("");
  const [secretOnce, setSecretOnce] = useState<{ id: string; secret: string; note: string } | null>(
    null,
  );
  const [copied, setCopied] = useState(false);

  // calendários
  const [calIntId, setCalIntId] = useState("");
  const [calProvider, setCalProvider] = useState("fixture");
  const [calAccount, setCalAccount] = useState("");
  const [calFormError, setCalFormError] = useState<string | null>(null);
  const [syncOut, setSyncOut] = useState<Record<string, IfSyncResult>>({});
  const [openAccId, setOpenAccId] = useState<string | null>(null);
  const [calEvents, setCalEvents] = useState<Record<string, IfCalendarEvent[]>>({});
  const [conflicts, setConflicts] = useState<Record<string, IfConflict[]>>({});

  // temporal
  const [tz, setTz] = useState("UTC");
  const [tzLoaded, setTzLoaded] = useState(false);
  const [tzError, setTzError] = useState<string | null>(null);

  const refreshAll = () => {
    listIfCatalog()
      .then((c) => setCatalog(c ?? []))
      .catch(() => undefined);
    listIfIntegrations()
      .then((i) => setIntegrations(i ?? []))
      .catch(() => undefined);
    listIfEvents(200)
      .then((e) => setEvents(e ?? []))
      .catch(() => undefined);
    listIfCalendarAccounts()
      .then((a) => setAccounts(a ?? []))
      .catch(() => undefined);
    listPrRules()
      .then((r) => setRules(r ?? []))
      .catch(() => undefined);
    getPrControls()
      .then((c) => {
        if (c?.timezone) setTz(c.timezone);
        setTzLoaded(true);
      })
      .catch(() => setTzLoaded(true));
  };

  useEffect(() => {
    refreshAll();
  }, []);

  const gated = async () => {
    if (await ping()) return true;
    toast.info(t("demo_hint"));
    return false;
  };

  // rótulos i18n para os helpers puros (badges, códigos de erro estáveis)
  const intLabels: Record<string, string> = {
    unconfigured: t("if_st_unconfigured"),
    configured: t("if_st_configured"),
    active: t("if_st_active"),
    degraded: t("if_st_degraded"),
    disabled: t("if_st_disabled"),
    error: t("if_st_error"),
  };
  const evLabels: Record<string, string> = {
    received: t("if_ev_st_received"),
    normalized: t("if_ev_st_normalized"),
    forwarded: t("if_ev_st_forwarded"),
    duplicate: t("if_ev_st_duplicate"),
    rejected: t("if_ev_st_rejected"),
    error: t("if_ev_st_error"),
  };
  const trustLabels: Record<string, string> = { authenticated: t("if_trust_authenticated") };
  const codeLabels: Record<string, string> = {
    if_invalid_json: t("if_code_if_invalid_json"),
    if_invalid_event_type: t("if_code_if_invalid_event_type"),
    if_event_type_not_allowed: t("if_code_if_event_type_not_allowed"),
    if_unknown_schema_version: t("if_code_if_unknown_schema_version"),
    if_missing_event_id: t("if_code_if_missing_event_id"),
    if_signature_invalid: t("if_code_if_signature_invalid"),
    if_signature_mismatch: t("if_code_if_signature_mismatch"),
    if_timestamp_expired: t("if_code_if_timestamp_expired"),
    if_integration_disabled: t("if_code_if_integration_disabled"),
    if_payload_too_large: t("if_code_if_payload_too_large"),
    if_rate_limited: t("if_code_if_rate_limited"),
    cal_provider_unavailable: t("if_code_cal_provider_unavailable"),
    cal_oauth_not_connected: t("if_code_cal_oauth_not_connected"),
    pr_invalid_timezone: t("if_code_pr_invalid_timezone"),
  };

  /** Mensagem amigável a partir de um erro do bridge (código estável → tradução). */
  const failText = (e: unknown) => {
    const code = ifErrorCode(e);
    const friendly = code ? ifErrorCodeLabel(code, codeLabels) : "";
    return friendly || String((e as Error).message);
  };

  const fail = (e: unknown) => toast.error(`${t("if_action_fail")} — ${failText(e)}`);

  const loadProducers = (integrationId: string) =>
    listIfProducers(integrationId)
      .then((p) => setProducers((m) => ({ ...m, [integrationId]: p ?? [] })))
      .catch(() => undefined);

  const toggleInt = (id: string) => {
    if (openIntId === id) {
      setOpenIntId(null);
      return;
    }
    setOpenIntId(id);
    setSecretOnce(null);
    setProducerName("");
    setProducerTypes("");
    loadProducers(id);
  };

  const createIntegration = async () => {
    if (!(await gated())) return;
    const err = validateIfIntegrationForm({ kind: formKind, adapter: formAdapter, name: formName });
    if (err) {
      setFormError(err);
      return;
    }
    let config: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(formConfig || "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) config = parsed;
    } catch {
      setFormError("if_err_config_json");
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      await createIfIntegration({
        kind: formKind,
        adapter: formAdapter,
        name: formName.trim(),
        config,
      });
      toast.success(t("if_created"));
      setFormName("");
      setFormConfig("{}");
      setFormOpen(false);
      refreshAll();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const changeState = async (it: IfIntegration, action: "activate" | "disable") => {
    if (!(await gated())) return;
    setBusy(true);
    try {
      if (action === "activate") await activateIfIntegration(it.id);
      else await disableIfIntegration(it.id);
      toast.success(t("if_state_changed"));
      refreshAll();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const testConnectivity = async (it: IfIntegration) => {
    if (!(await gated())) return;
    setBusy(true);
    try {
      const out = await testIfIntegration(it.id);
      if (out?.health && (out.health as Record<string, unknown>)["ok"] === true)
        toast.success(t("if_test_ok"));
      else toast.error(t("if_test_fail"));
      refreshAll();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const createProducer = async (it: IfIntegration) => {
    if (!(await gated())) return;
    const err = validateIfProducerForm({ name: producerName });
    if (err) {
      toast.error(t(err as never));
      return;
    }
    setBusy(true);
    try {
      const out = await createIfProducer(it.id, {
        name: producerName.trim(),
        allowedEventTypes: ifAllowedEventTypesFromText(producerTypes),
      });
      if (out?.secret) {
        // §13: o segredo aparece UMA vez — mantido em memória até ser dispensado.
        setSecretOnce({ id: out.id, secret: out.secret, note: out.note });
        setCopied(false);
      }
      setProducerName("");
      setProducerTypes("");
      loadProducers(it.id);
      refreshAll();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const copySecret = async () => {
    if (!secretOnce) return;
    try {
      await navigator.clipboard.writeText(secretOnce.secret);
      setCopied(true);
    } catch {
      toast.error(t("if_copy_fail"));
    }
  };

  // ---------- calendários ----------

  const connectAccount = async () => {
    if (!(await gated())) return;
    const err = validateIfCalendarAccountForm({
      integrationId: calIntId,
      provider: calProvider,
      providerAccount: calAccount,
    });
    if (err) {
      setCalFormError(err);
      return;
    }
    setBusy(true);
    setCalFormError(null);
    try {
      const out = await createIfCalendarAccount({
        integrationId: calIntId.trim(),
        provider: calProvider,
        providerAccount: calAccount.trim(),
      });
      if (out && typeof out === "object" && "error" in out && out.error) {
        toast.error(`${t("if_action_fail")} — ${ifErrorCodeLabel(out.error, codeLabels)}`);
        return;
      }
      toast.success(t("if_cal_connected"));
      setCalAccount("");
      refreshAll();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const syncAccount = async (acc: IfCalendarAccount) => {
    if (!(await gated())) return;
    setBusy(true);
    try {
      const out = await syncIfCalendarAccount(acc.id);
      if (out) {
        setSyncOut((m) => ({ ...m, [acc.id]: out }));
        toast.success(t("if_cal_synced"));
      }
      refreshAll();
    } catch (e) {
      // Indisponibilidade do provider REAL é explícita (503 + código estável) — nunca simulada.
      toast.error(`${t("if_cal_unavailable")} — ${failText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const toggleAcc = (id: string) => {
    if (openAccId === id) {
      setOpenAccId(null);
      return;
    }
    setOpenAccId(id);
    listIfCalendarEvents(id)
      .then((evs) => setCalEvents((m) => ({ ...m, [id]: evs ?? [] })))
      .catch(() => undefined);
    listIfCalendarConflicts(id)
      .then((c) => setConflicts((m) => ({ ...m, [id]: c ?? [] })))
      .catch(() => undefined);
  };

  // ---------- temporal ----------

  const saveTimezone = async () => {
    if (!(await gated())) return;
    const err = validateIfTimezone(tz);
    if (err) {
      setTzError(err);
      return;
    }
    setBusy(true);
    setTzError(null);
    try {
      const saved = await savePrControls({ timezone: tz.trim() });
      if (saved?.timezone) setTz(saved.timezone);
      toast.success(t("if_timezone_saved"));
    } catch (e) {
      fail(e); // pr_invalid_timezone → mensagem amigável (o servidor valida fail-closed)
    } finally {
      setBusy(false);
    }
  };

  // rótulos i18n para os helpers puros
  const calIntegrations = (integrations ?? []).filter((i) => i.kind === "calendar");
  const webhookIntegrations = (integrations ?? []).filter((i) => i.kind === "webhook");
  const rejected = (events ?? []).filter((e) => e.status === "rejected" || e.status === "error");

  return (
    <div className="h-screen overflow-y-auto p-6 md:p-10">
      <PageHeader title={t("if_title")} sub={t("if_sub")} />
      <Tabs value={tab} onValueChange={setTab} className="space-y-6">
        <TabsList className="border border-border bg-secondary/60 p-1">
          <TabsTrigger value="integrations" className="flex items-center gap-2">
            <Plug className="h-3.5 w-3.5" />
            {t("if_tab_integrations")}
          </TabsTrigger>
          <TabsTrigger value="webhooks" className="flex items-center gap-2">
            <Webhook className="h-3.5 w-3.5" />
            {t("if_tab_webhooks")}
          </TabsTrigger>
          <TabsTrigger value="inspector" className="flex items-center gap-2">
            <Radar className="h-3.5 w-3.5" />
            {t("if_tab_inspector")}
          </TabsTrigger>
          <TabsTrigger value="calendars" className="flex items-center gap-2">
            <Calendar className="h-3.5 w-3.5" />
            {t("if_tab_calendars")}
          </TabsTrigger>
          <TabsTrigger value="temporal" className="flex items-center gap-2">
            <Clock className="h-3.5 w-3.5" />
            {t("if_tab_temporal")}
          </TabsTrigger>
        </TabsList>

        {/* ---------- INTEGRAÇÕES ---------- */}
        <TabsContent value="integrations" className="space-y-6 focus-visible:outline-none">
          <section>
            <div className="hud-label mb-2">{t("if_catalog")}</div>
            {catalog !== null && catalog.length === 0 && (
              <p className="text-sm text-muted-foreground">{t("if_empty")}</p>
            )}
            <div className="grid gap-3 md:grid-cols-2">
              {(catalog ?? []).map((c) => (
                <div key={c.kind} className="hud-panel p-4" data-testid="if-catalog-row">
                  <div className="flex items-center gap-2">
                    <Cable className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">{c.kind}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{c.description}</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {c.capabilities.map((cap) => (
                      <Badge key={cap} variant="outline" className="text-[10px]">
                        {cap}
                      </Badge>
                    ))}
                  </div>
                  {c.providers && c.providers.length > 0 && (
                    <div className="hud-label mt-2 text-[10px]">
                      {t("if_providers")}: {c.providers.join(", ")}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <div className="hud-label">{t("if_integrations")}</div>
              <Button size="sm" variant="outline" onClick={() => setFormOpen((v) => !v)}>
                {formOpen ? <X className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                {formOpen ? t("cancel") : t("if_create")}
              </Button>
            </div>

            {formOpen && (
              <div className="hud-panel mb-4 space-y-3 p-4" data-testid="if-create-form">
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <div className="hud-label mb-1 text-xs">{t("if_kind")}</div>
                    <select
                      value={formKind}
                      onChange={(e) => {
                        const kind = e.target.value as "webhook" | "calendar";
                        setFormKind(kind);
                        setFormAdapter(kind === "webhook" ? "webhook" : "fixture");
                      }}
                      className={selectCls}
                    >
                      <option value="webhook">{t("if_kind_webhook")}</option>
                      <option value="calendar">{t("if_kind_calendar")}</option>
                    </select>
                  </div>
                  <div>
                    <div className="hud-label mb-1 text-xs">{t("if_adapter")}</div>
                    <select
                      value={formAdapter}
                      onChange={(e) => setFormAdapter(e.target.value)}
                      className={selectCls}
                    >
                      {(formKind === "webhook" ? IF_WEBHOOK_ADAPTERS : IF_CALENDAR_ADAPTERS).map(
                        (a) => (
                          <option key={a} value={a}>
                            {a}
                          </option>
                        ),
                      )}
                    </select>
                  </div>
                </div>
                <div>
                  <div className="hud-label mb-1 text-xs">{t("name")}</div>
                  <Input value={formName} onChange={(e) => setFormName(e.target.value)} />
                </div>
                <div>
                  <div className="hud-label mb-1 text-xs">{t("if_config_json")}</div>
                  <Textarea
                    rows={2}
                    value={formConfig}
                    onChange={(e) => setFormConfig(e.target.value)}
                  />
                </div>
                {formError && <p className="text-xs text-destructive">{t(formError as never)}</p>}
                <Button size="sm" disabled={busy} onClick={createIntegration}>
                  <Check className="h-3 w-3" />
                  {t("if_create")}
                </Button>
              </div>
            )}

            {integrations !== null && integrations.length === 0 && (
              <p className="text-sm text-muted-foreground">{t("if_integrations_empty")}</p>
            )}
            <div className="space-y-3">
              {(integrations ?? []).map((it) => {
                const badge = ifIntegrationStatusBadge(it.status, intLabels);
                return (
                  <div key={it.id} className="hud-panel p-4" data-testid="if-integration-row">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={badge.variant} className={badge.className}>
                        {badge.label}
                      </Badge>
                      <span className="flex-1 text-sm">{it.name}</span>
                      <span className="hud-label text-xs">
                        {it.kind} · {it.adapter}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>
                        {t("if_last_contact")}: {it.last_contact_at ?? t("pr_rule_never")}
                      </span>
                      <Badge
                        variant={
                          it.health && (it.health as Record<string, unknown>)["ok"] === true
                            ? "secondary"
                            : "outline"
                        }
                        className={
                          it.health && (it.health as Record<string, unknown>)["ok"] === true
                            ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-600"
                            : "text-muted-foreground"
                        }
                      >
                        {t("if_health")}:{" "}
                        {it.health && (it.health as Record<string, unknown>)["ok"] === true
                          ? t("if_health_ok")
                          : t("if_health_fail")}
                      </Badge>
                    </div>
                    {it.last_error && (
                      <div className="mt-1 text-xs text-destructive">
                        {t("if_last_error")}: {it.last_error}
                      </div>
                    )}

                    <div className="mt-3 flex flex-wrap gap-2">
                      {it.status !== "active" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => changeState(it, "activate")}
                        >
                          <Zap className="h-3 w-3" />
                          {t("if_activate")}
                        </Button>
                      )}
                      {it.status !== "disabled" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => changeState(it, "disable")}
                        >
                          <X className="h-3 w-3" />
                          {t("if_disable")}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => testConnectivity(it)}
                      >
                        <RefreshCw className="h-3 w-3" />
                        {t("if_test")}
                      </Button>
                      {it.kind === "webhook" && (
                        <Button size="sm" variant="outline" onClick={() => toggleInt(it.id)}>
                          <Webhook className="h-3 w-3" />
                          {t("if_producers")}
                        </Button>
                      )}
                    </div>

                    {/* Produtores: segredo exibido UMA vez (§13) */}
                    {it.kind === "webhook" && openIntId === it.id && (
                      <div
                        className="mt-3 space-y-3 rounded-md border border-border p-3"
                        data-testid="if-producers"
                      >
                        <div className="hud-label text-xs">{t("if_producers")}</div>
                        <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
                          <Input
                            placeholder={t("name")}
                            value={producerName}
                            onChange={(e) => setProducerName(e.target.value)}
                          />
                          <Input
                            placeholder={t("if_producer_types_hint")}
                            value={producerTypes}
                            onChange={(e) => setProducerTypes(e.target.value)}
                          />
                          <Button size="sm" disabled={busy} onClick={() => createProducer(it)}>
                            <Plus className="h-3 w-3" />
                            {t("if_producer_create")}
                          </Button>
                        </div>

                        {secretOnce && (
                          <div
                            className="space-y-1 rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3"
                            data-testid="if-secret-once"
                          >
                            <div className="text-xs font-medium text-yellow-600">
                              ⚠ {t("if_secret_warning")}
                            </div>
                            <code className="block break-all rounded bg-secondary/60 p-2 font-mono text-xs">
                              {secretOnce.secret}
                            </code>
                            <div className="flex gap-2">
                              <Button size="sm" variant="outline" onClick={copySecret}>
                                {copied ? (
                                  <Check className="h-3 w-3" />
                                ) : (
                                  <Copy className="h-3 w-3" />
                                )}
                                {copied ? t("if_secret_copied") : t("if_secret_copy")}
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setSecretOnce(null)}>
                                {t("if_secret_dismiss")}
                              </Button>
                            </div>
                          </div>
                        )}

                        {producers[it.id]?.length === 0 && (
                          <p className="text-xs text-muted-foreground">{t("if_producers_empty")}</p>
                        )}
                        <ul className="space-y-1 text-xs">
                          {(producers[it.id] ?? []).map((p) => (
                            <li key={p.id} className="font-mono" data-testid="if-producer-row">
                              {p.name} · {t("if_events_count")}: {p.event_count} ·{" "}
                              {t("if_rejected_count")}: {p.rejected_count}
                              {p.disabled_at ? ` · ${t("if_st_disabled")}` : ""}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </TabsContent>

        {/* ---------- WEBHOOKS ---------- */}
        <TabsContent value="webhooks" className="space-y-6 focus-visible:outline-none">
          <div
            className="hud-panel p-4 text-sm text-muted-foreground"
            data-testid="if-webhook-hint"
          >
            {t("if_webhook_hint_prefix")}
            {formatIfSignatureWindow(IF_SIGNATURE_WINDOW_MS).text}
            {t("if_webhook_hint_suffix")}
          </div>
          {webhookIntegrations !== null && webhookIntegrations.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("if_integrations_empty")}</p>
          )}
          {webhookIntegrations.map((it) => (
            <section key={it.id}>
              <div className="hud-label mb-2">{it.name}</div>
              {producers[it.id] === undefined && (
                <Button size="sm" variant="outline" onClick={() => toggleInt(it.id)}>
                  <Webhook className="h-3 w-3" />
                  {t("if_producers")}
                </Button>
              )}
              <div className="space-y-2">
                {(producers[it.id] ?? []).map((p) => (
                  <div key={p.id} className="hud-panel p-3" data-testid="if-webhook-row">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm">{p.name}</span>
                      {p.disabled_at && (
                        <Badge variant="outline" className="text-[10px] text-muted-foreground">
                          {t("if_st_disabled")}
                        </Badge>
                      )}
                    </div>
                    <div className="hud-label mt-1 text-[10px]">{t("if_ingress_url")}</div>
                    <code className="block break-all rounded bg-secondary/60 p-1.5 font-mono text-xs">
                      POST {ifIngressPath(p.id)}
                    </code>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {t("if_events_count")}: {p.event_count} · {t("if_rejected_count")}:{" "}
                      {p.rejected_count}
                      {p.last_event_at ? ` · ${t("if_last_event")}: ${p.last_event_at}` : ""}
                    </div>
                    {p.allowed_event_types.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {p.allowed_event_types.map((tp) => (
                          <Badge key={tp} variant="outline" className="text-[10px]">
                            {tp}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </TabsContent>

        {/* ---------- EVENT INSPECTOR ---------- */}
        <TabsContent value="inspector" className="space-y-6 focus-visible:outline-none">
          <section>
            <div className="hud-label mb-2">{t("if_inspector")}</div>
            {events !== null && events.length === 0 && (
              <p className="text-sm text-muted-foreground">{t("if_inspector_empty")}</p>
            )}
            <div className="space-y-2">
              {(events ?? []).map((e) => {
                const st = ifEventStatusBadge(e.status, evLabels);
                const trust = ifTrustBadge(e.trust_level, trustLabels);
                return (
                  <div key={e.id} className="hud-panel p-3" data-testid="if-event-row">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={st.variant} className={st.className}>
                        {st.label}
                      </Badge>
                      <Badge variant={trust.variant} className={trust.className}>
                        {trust.label}
                      </Badge>
                      <span className="flex-1 font-mono text-xs">{e.event_type}</span>
                      <span className="hud-label text-[10px]">{e.received_at}</span>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {t("if_ev_producer")}: {e.producer_name} · {t("if_ev_schema")}:{" "}
                      {e.schema_version}
                      {e.correlation_id ? ` · ${t("col_corr")}: ${e.correlation_id}` : ""}
                    </div>
                    {e.error_code && (
                      <div className="mt-1 text-xs text-destructive" data-testid="if-event-error">
                        {t("if_ev_error_code")}: {ifErrorCodeLabel(e.error_code, codeLabels)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <section>
            <div className="hud-label mb-2">{t("if_rejections")}</div>
            {rejected.length === 0 && (
              <p className="text-sm text-muted-foreground">{t("if_no_rejections")}</p>
            )}
            <ul className="space-y-1 text-xs">
              {rejected.map((e) => (
                <li key={e.id} className="font-mono" data-testid="if-rejection-row">
                  {e.received_at} · {e.event_type} · {ifErrorCodeLabel(e.error_code, codeLabels)}
                </li>
              ))}
            </ul>
          </section>
        </TabsContent>

        {/* ---------- CALENDÁRIOS ---------- */}
        <TabsContent value="calendars" className="space-y-6 focus-visible:outline-none">
          <section>
            <div className="hud-label mb-2">{t("if_cal_connect")}</div>
            <div className="hud-panel grid gap-3 p-4 md:grid-cols-[1fr_1fr_1fr_auto]">
              <select
                value={calIntId}
                onChange={(e) => setCalIntId(e.target.value)}
                className={selectCls}
              >
                <option value="">{t("if_cal_integration")}</option>
                {calIntegrations.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
              <select
                value={calProvider}
                onChange={(e) => setCalProvider(e.target.value)}
                className={selectCls}
              >
                {IF_CALENDAR_ADAPTERS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
              <Input
                placeholder={t("if_cal_account")}
                value={calAccount}
                onChange={(e) => setCalAccount(e.target.value)}
              />
              <Button size="sm" disabled={busy} onClick={connectAccount}>
                <Check className="h-3 w-3" />
                {t("if_cal_connect")}
              </Button>
            </div>
            {calFormError && (
              <p className="mt-1 text-xs text-destructive">{t(calFormError as never)}</p>
            )}
          </section>

          <section>
            <div className="hud-label mb-2">{t("if_cal")}</div>
            {accounts !== null && accounts.length === 0 && (
              <p className="text-sm text-muted-foreground">{t("if_cal_empty")}</p>
            )}
            <div className="space-y-3">
              {(accounts ?? []).map((acc) => (
                <div key={acc.id} className="hud-panel p-4" data-testid="if-account-row">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex-1 text-sm">{acc.provider_account}</span>
                    {acc.provider_test_only && (
                      <Badge
                        variant="destructive"
                        className="text-[10px]"
                        data-testid="if-test-only"
                      >
                        {t("if_cal_test_only")}
                      </Badge>
                    )}
                    <span className="hud-label text-xs">
                      {acc.provider} · {acc.status}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {t("if_sync_cursor")}: {acc.sync_cursor ?? "—"} · {t("if_last_sync")}:{" "}
                    {acc.last_sync_at ?? t("pr_rule_never")}
                    {acc.last_error ? ` · ${t("if_last_error")}: ${acc.last_error}` : ""}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => syncAccount(acc)}
                    >
                      <RefreshCw className="h-3 w-3" />
                      {t("if_cal_sync")}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => toggleAcc(acc.id)}>
                      {openAccId === acc.id ? (
                        <X className="h-3 w-3" />
                      ) : (
                        <Calendar className="h-3 w-3" />
                      )}
                      {t("if_cal_events")}
                    </Button>
                  </div>

                  {(() => {
                    const s = syncOut[acc.id];
                    return s ? (
                      <div className="mt-2 text-xs text-muted-foreground" data-testid="if-sync-out">
                        {ifSyncSummary(s, {
                          created: t("if_sync_created"),
                          cancelled: t("if_sync_cancelled"),
                          cursor: t("if_sync_cursor"),
                        })}
                      </div>
                    ) : null;
                  })()}

                  {openAccId === acc.id && (
                    <div className="mt-3 space-y-3">
                      <div>
                        <div className="hud-label mb-1 text-xs">{t("if_cal_events")}</div>
                        {calEvents[acc.id]?.length === 0 && (
                          <p className="text-xs text-muted-foreground">{t("if_empty")}</p>
                        )}
                        <ul className="space-y-1 text-xs">
                          {(calEvents[acc.id] ?? []).map((ev) => (
                            <li
                              key={ev.external_id}
                              className="font-mono"
                              data-testid="if-cal-event-row"
                            >
                              {ev.starts_at_utc ?? "—"} · {ev.title} · {ev.status}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <div className="hud-label mb-1 text-xs">{t("if_cal_conflicts")}</div>
                        {conflicts[acc.id]?.length === 0 && (
                          <p className="text-xs text-muted-foreground">
                            {t("if_cal_conflicts_empty")}
                          </p>
                        )}
                        <ul className="space-y-1 text-xs">
                          {(conflicts[acc.id] ?? []).map((c) => (
                            <li
                              key={c.id}
                              className="text-destructive"
                              data-testid="if-conflict-row"
                            >
                              {t("if_event_a")}: {c.eventA?.title ?? "?"} (
                              {c.eventA?.starts_at_utc ?? "—"}) ↔ {t("if_event_b")}:{" "}
                              {c.eventB?.title ?? "?"} ({c.eventB?.starts_at_utc ?? "—"})
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        </TabsContent>

        {/* ---------- TEMPORAL ---------- */}
        <TabsContent value="temporal" className="space-y-6 focus-visible:outline-none">
          <section className="hud-panel max-w-md space-y-3 p-4" data-testid="if-timezone">
            <div className="hud-label text-xs">{t("if_timezone")}</div>
            <Input
              value={tz}
              onChange={(e) => setTz(e.target.value)}
              placeholder="America/Sao_Paulo"
            />
            <p className="text-[10px] text-muted-foreground">{t("if_timezone_hint")}</p>
            {tzError && <p className="text-xs text-destructive">{t(tzError as never)}</p>}
            <Button size="sm" disabled={busy} onClick={saveTimezone}>
              <Check className="h-3 w-3" />
              {t("if_timezone_save")}
            </Button>
            {!tzLoaded && controls === null && (
              <p className="text-xs text-muted-foreground">{t("if_load_fail")}</p>
            )}
          </section>

          <section>
            <div className="hud-label mb-2">{t("if_rules_tz")}</div>
            {rules !== null && rules.length === 0 && (
              <p className="text-sm text-muted-foreground">{t("if_rules_tz_empty")}</p>
            )}
            <div className="space-y-2">
              {(rules ?? []).map((r) => (
                <div key={r.id} className="hud-panel p-3" data-testid="if-rule-row">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex-1 text-sm">{r.name}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {r.trigger_kind}
                    </Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {t("if_rule_tz")}: {r.timezone ?? "UTC"} · {t("pr_rule_next_run")}:{" "}
                    {r.next_run_at ?? t("pr_rule_never")}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </TabsContent>
      </Tabs>
    </div>
  );
}
