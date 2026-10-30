import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Pencil, Plus, Power, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  createPolicy,
  deletePolicy,
  listPolicies,
  ping,
  simulatePolicy,
  updatePolicy,
  type Policy,
  type PolicyEffect,
  type PolicyOp,
  type PolicyScope,
} from "@/lib/bridge";
import { wfEffectBadge } from "@/lib/workflow-ui";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/policies")({
  head: () => ({
    meta: [
      { title: "Policy Studio — Jarvis" },
      {
        name: "description",
        content:
          "Políticas comportamentais avaliadas no servidor: negar, exigir aprovação ou permitir, com simulador.",
      },
      { property: "og:title", content: "Policy Studio — Jarvis" },
      {
        property: "og:description",
        content: "Políticas versionadas com simulador de decisão — nada sai do seu computador.",
      },
    ],
  }),
  component: PoliciesPage,
});

const POL_SCOPES: PolicyScope[] = ["tool", "workflow", "agent"];
const POL_EFFECTS: PolicyEffect[] = ["allow", "deny", "require_approval"];
const POL_OPS: PolicyOp[] = ["eq", "ne", "in", "not_in", "exists"];

type CondDraft = { field: string; op: PolicyOp; value: string };
type PolForm = {
  id?: string;
  name: string;
  description: string;
  scope: PolicyScope;
  target: string;
  effect: PolicyEffect;
  priority: number;
  enabled: boolean;
  conditions: CondDraft[];
};

const blank: PolForm = {
  name: "",
  description: "",
  scope: "tool",
  target: "*",
  effect: "deny",
  priority: 0,
  enabled: true,
  conditions: [],
};

const toForm = (p: Policy): PolForm => ({
  id: p.id,
  name: p.name,
  description: p.description ?? "",
  scope: p.scope,
  target: p.target,
  effect: p.effect,
  priority: p.priority,
  enabled: p.enabled,
  conditions: p.conditions.map((c) => ({
    field: c.field,
    op: c.op,
    value: Array.isArray(c.value)
      ? c.value.join(", ")
      : c.value === undefined
        ? ""
        : String(c.value),
  })),
});

export function PoliciesPage() {
  const { t } = useI18n();
  const [policies, setPolicies] = useState<Policy[] | null>(null);
  const [edit, setEdit] = useState<PolForm>(blank);
  // Simulador: decisão avaliada pelo servidor (nunca no cliente).
  const [sim, setSim] = useState<{
    kind: PolicyScope;
    target: string;
    tool: string;
    scope: string;
  }>({
    kind: "tool",
    target: "",
    tool: "",
    scope: "",
  });
  const [simOut, setSimOut] = useState<{
    decision: string;
    matched: string | null;
    reason?: string | null;
  } | null>(null);

  const scopeLabel = (s: string): string =>
    s === "workflow"
      ? t("pol_scope_workflow")
      : s === "agent"
        ? t("pol_scope_agent")
        : t("pol_scope_tool");
  const opLabels: Record<string, string> = {
    eq: t("pol_op_eq"),
    ne: t("pol_op_ne"),
    in: t("pol_op_in"),
    not_in: t("pol_op_not_in"),
    exists: t("pol_op_exists"),
  };
  const effectLabels: Record<string, string> = {
    allow: t("pol_effect_allow"),
    deny: t("pol_effect_deny"),
    require_approval: t("pol_effect_require_approval"),
  };

  const refresh = () => listPolicies().then((p) => setPolicies(p ?? []));

  useEffect(() => {
    refresh().catch(() => undefined);
  }, []);

  const gated = async () => {
    if (await ping()) return true;
    toast.info(t("demo_hint"));
    return false;
  };

  const save = async () => {
    if (!edit.name.trim()) return;
    // in/not_in exigem lista; exists não leva valor; demais levam valor escalar.
    const conditions = edit.conditions
      .filter((c) => c.field.trim())
      .map((c) => {
        if (c.op === "exists") return { field: c.field.trim(), op: c.op };
        if (c.op === "in" || c.op === "not_in")
          return {
            field: c.field.trim(),
            op: c.op,
            value: c.value
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          };
        return { field: c.field.trim(), op: c.op, value: c.value };
      });
    if (!(await gated())) return;
    const body = {
      name: edit.name.trim(),
      description: edit.description,
      scope: edit.scope,
      target: edit.target.trim() || "*",
      effect: edit.effect,
      priority: edit.priority,
      enabled: edit.enabled,
      conditions,
    };
    try {
      if (edit.id) await updatePolicy(edit.id, body);
      else await createPolicy(body);
      toast.success(t("pol_saved"));
      setEdit(blank);
      refresh();
    } catch (e) {
      toast.error(String((e as Error).message));
    }
  };

  const toggleEnabled = async (p: Policy) => {
    if (!(await gated())) return;
    try {
      await updatePolicy(p.id, { enabled: !p.enabled });
      refresh();
    } catch (e) {
      toast.error(String((e as Error).message));
    }
  };

  const remove = async (p: Policy) => {
    if (!(await gated())) return;
    try {
      await deletePolicy(p.id);
      toast.success(t("pol_deleted"));
      refresh();
    } catch (e) {
      toast.error(String((e as Error).message));
    }
  };

  const runSim = async () => {
    if (!sim.target.trim()) return;
    if (!(await gated())) return;
    try {
      const out = await simulatePolicy({
        kind: sim.kind,
        target: sim.target.trim(),
        tool: sim.tool.trim() || undefined,
        scope: sim.scope.trim() || undefined,
      });
      setSimOut(out ?? null);
    } catch (e) {
      toast.error(String((e as Error).message));
    }
  };

  const setCond = (idx: number, patch: Partial<CondDraft>) =>
    setEdit({
      ...edit,
      conditions: edit.conditions.map((c, i) => (i === idx ? { ...c, ...patch } : c)),
    });

  return (
    <div className="h-screen overflow-y-auto p-6 md:p-10">
      <PageHeader title={t("pol_title")} sub={t("pol_sub")} />
      <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
        <div className="space-y-6">
          {/* Lista de políticas */}
          <section>
            <div className="hud-label mb-2">{t("pol_list")}</div>
            {policies !== null && policies.length === 0 && (
              <p className="text-sm text-muted-foreground">{t("pol_empty")}</p>
            )}
            <div className="space-y-3">
              {(policies ?? []).map((p) => {
                const badge = wfEffectBadge(p.effect, effectLabels);
                return (
                  <div key={p.id} className="hud-panel p-4" data-testid="pol-card">
                    <div className="flex items-start gap-3">
                      <div className="flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-display text-lg">{p.name}</span>
                          <Badge variant={badge.variant} className={badge.className}>
                            {badge.label}
                          </Badge>
                          <Badge variant="outline">{scopeLabel(p.scope)}</Badge>
                          <Badge variant="outline" className="font-mono text-[10px]">
                            {p.target}
                          </Badge>
                          {p.enabled ? (
                            <Badge
                              variant="secondary"
                              className="border-emerald-500/40 bg-emerald-500/15 text-emerald-600"
                            >
                              {t("pol_enabled")}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-muted-foreground">
                              {t("pol_disabled")}
                            </Badge>
                          )}
                        </div>
                        {p.description && (
                          <p className="mt-1 text-sm text-muted-foreground">{p.description}</p>
                        )}
                        {p.conditions.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {p.conditions.map((c, i) => (
                              <Badge key={i} variant="secondary" className="font-mono text-[10px]">
                                {c.field} {c.op}
                                {c.op === "exists"
                                  ? ""
                                  : ` ${Array.isArray(c.value) ? c.value.join("|") : String(c.value)}`}
                              </Badge>
                            ))}
                          </div>
                        )}
                        <div className="hud-label mt-2 text-xs">
                          {t("pol_priority")}: {p.priority} · {t("wf3_version")} {p.version}
                        </div>
                      </div>
                      <div className="flex flex-col gap-1">
                        <Button size="sm" variant="outline" onClick={() => setEdit(toForm(p))}>
                          <Pencil className="h-3 w-3" />
                          {t("pol_edit")}
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={p.enabled ? t("pol_disabled") : t("pol_enabled")}
                          onClick={() => toggleEnabled(p)}
                        >
                          <Power className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={t("pol_delete")}
                          onClick={() => remove(p)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Simulador de decisão */}
          <section className="hud-panel space-y-2 p-4" data-testid="pol-sim">
            <div className="hud-label">{t("pol_sim_title")}</div>
            <div className="grid gap-2 md:grid-cols-2">
              <label className="text-xs">
                {t("pol_kind")}
                <select
                  className="w-full rounded-md border border-input bg-secondary p-2 text-sm"
                  value={sim.kind}
                  onChange={(e) => setSim({ ...sim, kind: e.target.value as PolicyScope })}
                >
                  {POL_SCOPES.map((s) => (
                    <option key={s} value={s}>
                      {scopeLabel(s)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs">
                {t("pol_target")}
                <Input
                  value={sim.target}
                  onChange={(e) => setSim({ ...sim, target: e.target.value })}
                />
              </label>
              <label className="text-xs">
                {t("wf3_cfg_tool")}
                <Input
                  value={sim.tool}
                  placeholder="—"
                  onChange={(e) => setSim({ ...sim, tool: e.target.value })}
                />
              </label>
              <label className="text-xs">
                {t("pol_scope")}
                <Input
                  value={sim.scope}
                  placeholder="—"
                  onChange={(e) => setSim({ ...sim, scope: e.target.value })}
                />
              </label>
            </div>
            <Button size="sm" onClick={runSim} disabled={!sim.target.trim()}>
              {t("pol_sim_run")}
            </Button>
            {simOut && (
              <div className="space-y-1 border-t border-border pt-2" data-testid="pol-sim-result">
                {(() => {
                  const badge = wfEffectBadge(simOut.decision, effectLabels);
                  return (
                    <Badge variant={badge.variant} className={badge.className}>
                      {badge.label}
                    </Badge>
                  );
                })()}
                <p className="text-xs text-muted-foreground">
                  {simOut.matched
                    ? `${t("pol_matched")}: ${simOut.matched}${simOut.reason ? ` · ${t("pol_reason")}: ${simOut.reason}` : ""}`
                    : t("pol_no_match")}
                </p>
              </div>
            )}
          </section>
        </div>

        {/* Formulário lateral */}
        <aside className="hud-panel space-y-3 self-start p-4" data-testid="pol-form">
          <div className="hud-label">{edit.id ? t("pol_edit") : t("pol_new")}</div>
          <Input
            placeholder={t("pol_name")}
            value={edit.name}
            onChange={(e) => setEdit({ ...edit, name: e.target.value })}
          />
          <Textarea
            rows={2}
            placeholder={t("pol_description")}
            value={edit.description}
            onChange={(e) => setEdit({ ...edit, description: e.target.value })}
          />
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs">
              {t("pol_scope")}
              <select
                className="w-full rounded-md border border-input bg-secondary p-2 text-sm"
                value={edit.scope}
                onChange={(e) => setEdit({ ...edit, scope: e.target.value as PolicyScope })}
              >
                {POL_SCOPES.map((s) => (
                  <option key={s} value={s}>
                    {scopeLabel(s)}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              {t("pol_effect")}
              <select
                className="w-full rounded-md border border-input bg-secondary p-2 text-sm"
                value={edit.effect}
                onChange={(e) => setEdit({ ...edit, effect: e.target.value as PolicyEffect })}
              >
                {POL_EFFECTS.map((ef) => (
                  <option key={ef} value={ef}>
                    {effectLabels[ef]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <Input
            placeholder={t("pol_target")}
            value={edit.target}
            onChange={(e) => setEdit({ ...edit, target: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">{t("pol_target_hint")}</p>
          <label className="text-xs block">
            {t("pol_priority")}
            <Input
              type="number"
              value={edit.priority}
              onChange={(e) => setEdit({ ...edit, priority: Number(e.target.value) || 0 })}
            />
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={edit.enabled}
              onChange={(e) => setEdit({ ...edit, enabled: e.target.checked })}
            />
            {t("pol_enabled")}
          </label>

          <div className="hud-label">{t("pol_conditions")}</div>
          {edit.conditions.map((c, idx) => (
            <div key={idx} className="flex items-center gap-1">
              <Input
                className="w-28 font-mono text-xs"
                placeholder={t("pol_field")}
                value={c.field}
                onChange={(e) => setCond(idx, { field: e.target.value })}
              />
              <select
                className="w-24 rounded-md border border-input bg-secondary p-1 text-xs"
                value={c.op}
                onChange={(e) => setCond(idx, { op: e.target.value as PolicyOp })}
                aria-label={t("pol_op")}
              >
                {POL_OPS.map((op) => (
                  <option key={op} value={op}>
                    {opLabels[op]}
                  </option>
                ))}
              </select>
              {c.op !== "exists" && (
                <Input
                  className="flex-1 text-xs"
                  placeholder={
                    c.op === "in" || c.op === "not_in" ? t("pol_value_list") : t("pol_value")
                  }
                  value={c.value}
                  onChange={(e) => setCond(idx, { value: e.target.value })}
                />
              )}
              <Button
                size="icon"
                variant="ghost"
                aria-label={t("wf3_remove")}
                onClick={() =>
                  setEdit({ ...edit, conditions: edit.conditions.filter((_, i) => i !== idx) })
                }
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              setEdit({
                ...edit,
                conditions: [...edit.conditions, { field: "", op: "eq", value: "" }],
              })
            }
          >
            <Plus className="h-3 w-3" />
            {t("pol_add_condition")}
          </Button>

          <div className="flex gap-2">
            <Button className="flex-1" onClick={save}>
              {t("save")}
            </Button>
            <Button variant="outline" onClick={() => setEdit(blank)}>
              {t("cancel")}
            </Button>
          </div>
        </aside>
      </div>
    </div>
  );
}
