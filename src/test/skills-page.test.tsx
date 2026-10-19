// Página Skills — inspeção segura de Skills candidatas.
// Comprova: navegação normal, estados (vazio/carregando/veredito/erro), veredito condicional a
// campos realmente presentes na resposta, falhas explícitas (offline/400/401/413) sem falso
// sucesso, ausência de conteúdo do arquivo/relatório bruto e ausência de qualquer operação de
// instalação/ativação/execução. Nenhum fallback demo simula inspeção.
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Padrão do repo (chat-send.test.tsx): mock completo da ponte (sem importOriginal) e
// mockRejectedValueOnce para rejeições — determinístico em jsdom. (O teste de rota /skills
// vive em app-routing.test.tsx, onde o routeTree inteiro já é o contexto padrão.)
const inspectSkill = vi.fn();
const listSkillVerdicts = vi.fn();
vi.mock("@/lib/bridge", () => ({
  inspectSkill: (...a: unknown[]) => inspectSkill(...a),
  listSkillVerdicts: (...a: unknown[]) => listSkillVerdicts(...a),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

import { SkillsPage } from "@/routes/skills";

const SKILL_MD = () => new File(["# conteudo inerte de teste"], "SKILL.md", { type: "text/markdown" });

// Veredito REAL no formato devolvido por POST /api/skills/inspect (server/index.js).
const verdict = (decision = "passed", extra: Record<string, unknown> = {}) => ({
  verdictVersion: 1,
  finishedAt: "2026-10-19T03:00:00.000Z",
  artifact: { hash: { algorithm: "sha256", digest: "a".repeat(64) }, kind: "file", manifest: null },
  scan: { scanner: "skillspector", version: "2.13.0", mode: "static-only", flags: ["--no-llm", "--fail-on-incomplete"], exitCode: 0, coveragePercent: 100, analysisComplete: true },
  result: { decision, safeToInstall: decision === "passed", reviewRequired: true, reason: `motivo ${decision}`, issueCount: decision === "passed" ? 0 : 3 },
  constraints: { grantsPermissions: false, grantsActivation: false, allowsExecution: false, requiresHumanReview: true, boundToArtifactHash: "a".repeat(64), validity: "evidência limitada" },
  ...extra,
});

async function escolharEInspeccionar() {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  fireEvent.change(input, { target: { files: [SKILL_MD()] } });
  const botao = await waitFor(() => {
    const b = screen.getByRole("button", { name: /inspecionar/i });
    expect(b).toBeEnabled();
    return b;
  });
  fireEvent.click(botao);
}

// Histórico padrão para os testes (formato real devolvido por GET /api/skills/verdicts).
const historico = (verdicts: unknown[] = [], extra: Record<string, unknown> = {}) => ({ verdicts, truncated: false, skipped: 0, ...extra });
const item = (hash = "b".repeat(64), over: Record<string, unknown> = {}) => ({
  hash, finishedAt: "2026-10-19T03:00:00.000Z", decision: "passed", scannerVersion: "2.13.0", issueCount: 0, ...over,
});

beforeEach(() => {
  inspectSkill.mockReset();
  listSkillVerdicts.mockResolvedValue(historico());
});

describe("Página Skills (inspeção segura)", () => {
  it("estado vazio inicial: instruções, aviso permanente e NENHUMA operação de instalação/ativação", () => {
    render(<SkillsPage />);
    expect(screen.getByTestId("sk-empty")).toBeInTheDocument();
    expect(screen.getByTestId("sk-notice")).toHaveTextContent(/não instala nem ativa/);
    // Nenhum controle de instalação/ativação/execução — nem desabilitado.
    expect(screen.queryByRole("button", { name: /instalar|ativar|executar/i })).toBeNull();
  });

  it("carregamento durante o envio (botão desabilitado com rótulo de análise)", async () => {
    let resolve!: (v: unknown) => void;
    inspectSkill.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<SkillsPage />);
    await escolharEInspeccionar();
    expect(screen.getByRole("button", { name: /analisando/i })).toBeDisabled();
    resolve(verdict("passed"));
    await waitFor(() => expect(screen.getByTestId("sk-verdict")).toBeInTheDocument());
  });

  it.each(["passed", "failed", "incomplete", "blocked"] as const)(
    "veredito %s exibido com hash, scanner, achados e restrições",
    async (decision) => {
      inspectSkill.mockResolvedValue(verdict(decision));
      render(<SkillsPage />);
      await escolharEInspeccionar();
      await waitFor(() => expect(screen.getByTestId("sk-verdict")).toBeInTheDocument());
      expect(screen.getByTestId("sk-decision")).toBeInTheDocument();
      expect(screen.getByTestId("sk-hash")).toHaveTextContent("a".repeat(64));
      expect(screen.getByTestId("sk-scanner")).toHaveTextContent("skillspector 2.13.0");
      expect(screen.getByTestId("sk-findings")).toBeInTheDocument();
      expect(screen.getByTestId("sk-constraints")).toHaveTextContent(/Revisão humana obrigatória/);
    },
  );

  it("campos ausentes na resposta NÃO são inventados (hash/scanner/achados condicionais)", async () => {
    inspectSkill.mockResolvedValue(verdict("blocked", {
      artifact: { hash: { algorithm: "sha256", digest: null }, kind: null, manifest: null },
      scan: null,
      result: { decision: "blocked", safeToInstall: false, reviewRequired: true, reason: "scanner indisponível", issueCount: 0 },
    }));
    render(<SkillsPage />);
    await escolharEInspeccionar();
    await waitFor(() => expect(screen.getByTestId("sk-verdict")).toBeInTheDocument());
    expect(screen.queryByTestId("sk-hash")).toBeNull();
    expect(screen.queryByTestId("sk-scanner")).toBeNull();
    // O histórico agora existe (fatia posterior), mas só exibe o que a API devolveu —
    // e o mock desta inspeção não adiciona nada a ele: sem inventar registros.
    await waitFor(() => expect(screen.getByTestId("sk-history")).toBeInTheDocument());
    expect(screen.queryByTestId("sk-hist-item")).toBeNull();
  });

  it.each([
    ['400: {"error":"skill_file_required"}', /arquivo ausente ou vazio/i],
    ['400: {"error":"skill_file_empty"}', /arquivo ausente ou vazio/i],
    ['400: {"error":"skill_manifest_must_be_skill_md"}', /exatamente SKILL\.md/i],
    ['401: {"error":"unauthorized"}', /sessão ausente ou expirada/i],
    ['413: {"error":"payload_too_large"}', /demasiado grande/i],
    ['500: interno', /falha na inspeção/i],
  ])("erro %s tratado explicitamente, sem falso sucesso", async (msg, esperado) => {
    inspectSkill.mockRejectedValueOnce(new Error(msg));
    render(<SkillsPage />);
    await escolharEInspeccionar();
    await waitFor(() => expect(screen.getByTestId("sk-error")).toBeInTheDocument());
    expect(screen.getByTestId("sk-error")).toHaveTextContent(esperado);
    expect(screen.queryByTestId("sk-verdict")).toBeNull();
  });

  it("indisponibilidade do serviço (bridge_offline) falha explícito — nunca simula inspeção", async () => {
    inspectSkill.mockRejectedValueOnce(new Error("bridge_offline"));
    render(<SkillsPage />);
    await escolharEInspeccionar();
    await waitFor(() => expect(screen.getByTestId("sk-error")).toBeInTheDocument());
    expect(screen.getByTestId("sk-error")).toHaveTextContent(/nada foi simulado/i);
    expect(screen.queryByTestId("sk-verdict")).toBeNull();
  });

  it("conteúdo do arquivo e relatório bruto nunca aparecem na interface", async () => {
    // O veredito real não carrega conteúdo da candidata nem relatório bruto; a interface não
    // tem onde ecoá-los. Prova: veredito completo renderizado, conteúdo ausente.
    inspectSkill.mockResolvedValue(verdict("passed"));
    render(<SkillsPage />);
    await escolharEInspeccionar();
    await waitFor(() => expect(screen.getByTestId("sk-verdict")).toBeInTheDocument());
    expect(screen.queryByText(/conteudo inerte/)).toBeNull();
  });

  it("histórico: carregamento e depois lista preenchida com apenas os campos permitidos", async () => {
    let resolve!: (v: unknown) => void;
    listSkillVerdicts.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<SkillsPage />);
    expect(screen.getByTestId("sk-hist-loading")).toBeInTheDocument();
    resolve(historico([item(), item("c".repeat(64), { decision: "failed", finishedAt: "2026-10-19T01:00:00.000Z", issueCount: 3 })], { skipped: 2 }));
    await waitFor(() => expect(screen.getAllByTestId("sk-hist-item")).toHaveLength(2));
    expect(screen.getByText("b".repeat(64))).toBeInTheDocument(); // hash completo, monospace
    expect(screen.getByTestId("sk-hist-skipped")).toHaveTextContent("2 registro(s) inválido(s) ignorado(s)");
    // resposta não contém nada além da projeção: sem "reason", sem caminhos
    expect(screen.queryByText(/motivo/)).toBeNull();
  });

  it("histórico vazio é real (sem simulação)", async () => {
    listSkillVerdicts.mockResolvedValue(historico([]));
    render(<SkillsPage />);
    await waitFor(() => expect(screen.getByTestId("sk-hist-empty")).toBeInTheDocument());
  });

  it("histórico indisponível (offline) é dito explicitamente — nunca demo", async () => {
    listSkillVerdicts.mockResolvedValue(null);
    render(<SkillsPage />);
    await waitFor(() => expect(screen.getByTestId("sk-hist-unavailable")).toBeInTheDocument());
    expect(screen.getByTestId("sk-hist-unavailable")).toHaveTextContent(/nada é simulado/i);
  });

  it("erro HTTP no histórico é exibido explicitamente", async () => {
    listSkillVerdicts.mockRejectedValue(new Error("500: verdicts_unreadable"));
    render(<SkillsPage />);
    await waitFor(() => expect(screen.getByTestId("sk-hist-error")).toBeInTheDocument());
    expect(screen.getByTestId("sk-hist-error")).toHaveTextContent(/não foi possível carregar/i);
  });

  it("histórico: campos opcionais ausentes não são inventados", async () => {
    listSkillVerdicts.mockResolvedValue(historico([item("d".repeat(64), { scannerVersion: undefined, issueCount: undefined })]));
    render(<SkillsPage />);
    await waitFor(() => expect(screen.getByTestId("sk-hist-item")).toBeInTheDocument());
    const texto = screen.getByTestId("sk-hist-item").textContent;
    expect(texto).not.toContain("2.13.0");
    expect(texto).not.toContain(/achados/i);
  });

  it("histórico truncado é sinalizado", async () => {
    listSkillVerdicts.mockResolvedValue(historico([item()], { truncated: true }));
    render(<SkillsPage />);
    await waitFor(() => expect(screen.getByTestId("sk-hist-truncated")).toBeInTheDocument());
  });

  it("histórico é atualizado após uma inspeção concluída", async () => {
    listSkillVerdicts
      .mockResolvedValueOnce(historico()) // carga inicial: vazio
      .mockResolvedValueOnce(historico([item("e".repeat(64))])); // após a inspeção
    inspectSkill.mockResolvedValue(verdict("passed"));
    render(<SkillsPage />);
    await waitFor(() => expect(screen.getByTestId("sk-hist-empty")).toBeInTheDocument());
    await escolharEInspeccionar();
    await waitFor(() => expect(screen.getByTestId("sk-verdict")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText("e".repeat(64))).toBeInTheDocument(), );
  });
});
