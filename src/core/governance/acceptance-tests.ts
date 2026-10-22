import { TelemetryLogger } from "@/core/telemetry/telemetry-logger";
import { loadRoleSkill, buildSkillSystemPrompt } from "@/core/skills/skill-runtime";
import { dispatchStrongEvaluator, type EvaluatorCallResult } from "@/core/llm/evaluator-models";
import { recordLlmCost } from "@/core/llm/cost";
import { runTestBench, type TestBenchReport, type TestBenchRequest } from "@/core/execution/test-bench";
import { classifyRun } from "@/core/governance/defect-reproducer";
import type { RepairContractTest } from "@/core/orchestrator/repair-payload";

/**
 * E5 — autoteste (mudança 19 aprovada 17/10; §6 itens 6–7 decididos por delegação 22/10). A skill `testador`
 * escreve os testes de aceite de UMA etapa só pelo Microbrief (critérios por REQ, arquivos, contrato), sem ver
 * o código, em outra família de modelo que o executor. Teste do teste: rodado na bancada contra o projeto
 * ANTES da etapa, teste que já passa não prova nada e é descartado. Os que ficam se dividem em visíveis (o
 * executor vê e roda) e escondidos (só o portão roda — o executor não "decora"). Vivem fora do projeto
 * (pasta de reprodução da bancada): o executor não tem como editá-los.
 */
export interface AcceptanceTest extends RepairContractTest {
  req: string;
  /** false = escondido (só o portão roda). */
  visivel: boolean;
}

export interface AcceptanceTestSet {
  testes: AcceptanceTest[];
  /** REQ que máquina não julga (aparência, texto): só o avaliador. */
  julgamento: string[];
  /** Testes que já passavam sem o código (não provam nada) ou não eram teste. */
  descartados: Array<{ arquivo: string; motivo: string }>;
  /** Bancada fora: nenhum teste ficou (a etapa segue como antes). */
  bancadaFora?: boolean;
}

export interface AcceptanceInput {
  microbriefId: string;
  arquivos: string[];
  /**
   * Arquivos desta etapa que JÁ existem no projeto (etapa que modifica). Controle P4 22/10: teste certo de
   * "o que já funciona continua funcionando" passa antes do código — numa etapa que modifica, vira regressão
   * (tem de continuar passando); numa etapa que cria, passar antes não prova nada e o teste sai.
   */
  arquivosExistentes?: string[];
  criteriosPorReq: Record<string, string[]>;
  contrato?: string;
  /** Contratos das etapas de que esta depende (só leitura). */
  contratosDependencias?: string;
}

type Dispatch = (messages: { role: "system" | "user"; content: string }[]) => Promise<EvaluatorCallResult>;
type Bench = (projectPath: string, req: TestBenchRequest) => Promise<TestBenchReport>;

const defaultDispatch: Dispatch = (messages) =>
  dispatchStrongEvaluator(messages, {
    chain: [
      { provider: "claude", model: process.env.TESTER_MODEL || "claude-sonnet-5-5", routedPrefixes: ["anthropic/"] },
      { provider: "claude", model: process.env.TESTER_RESERVE_MODEL || "claude-opus-5-5", routedPrefixes: ["anthropic/"] },
    ],
    timeoutMs: 300_000,
    maxTokens: 16_000,
    executorFamily: "deepseek",
  });

export function buildTesterPrompt(input: AcceptanceInput): { role: "system" | "user"; content: string }[] {
  const reqs = Object.entries(input.criteriosPorReq)
    .map(([req, c]) => `- ${req}: ${c.join(" ")}`)
    .join("\n");
  return [
    { role: "system", content: buildSkillSystemPrompt(loadRoleSkill("testador")) },
    {
      role: "user",
      content:
        `[ETAPA ${input.microbriefId}] Arquivos que o executor vai escrever: ${input.arquivos.join(", ")}\n\n` +
        `[CRITÉRIOS DE ACEITE POR REQ]\n${reqs}\n` +
        (input.contrato ? `\n[CONTRATO DESTA ETAPA (o que ela produz)]\n${input.contrato.slice(0, 8000)}\n` : "") +
        (input.contratosDependencias ? `\n[CONTRATOS DAS DEPENDÊNCIAS (já existem no projeto; só leitura)]\n${input.contratosDependencias.slice(0, 20_000)}\n` : ""),
    },
  ];
}

const safe = (s: string) => s.replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "aceite";

export function parseTesterAnswer(raw: string | null): { testes: Array<{ req: string; arquivo: string; conteudo: string }>; julgamento: string[] } | null {
  if (!raw) return null;
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    const testes = (Array.isArray(j.testes) ? j.testes : [])
      .filter((t: any) => t && typeof t.conteudo === "string" && t.conteudo.includes("vitest") && typeof t.req === "string")
      .map((t: any, i: number) => ({
        req: String(t.req),
        arquivo: `aceite-${i + 1}-${safe(String(t.arquivo || t.req)).replace(/(\.test)?\.(ts|tsx|js)$/, "")}.test.ts`,
        conteudo: String(t.conteudo),
      }));
    const julgamento = (Array.isArray(j.julgamento) ? j.julgamento : []).filter((x: unknown) => typeof x === "string");
    return { testes, julgamento };
  } catch {
    return null;
  }
}

export async function generateAcceptanceTests(params: {
  sessionId?: string;
  projectPath: string;
  input: AcceptanceInput;
  dispatch?: Dispatch;
  bench?: Bench;
}): Promise<AcceptanceTestSet> {
  // Como a revisão final: em teste, sem dispatch injetado, não chama modelo de verdade (rede, chave, tempo).
  if (!params.dispatch && process.env.NODE_ENV === "test") return { testes: [], julgamento: [], descartados: [], bancadaFora: true };
  const dispatch = params.dispatch ?? defaultDispatch;
  const bench = params.bench ?? runTestBench;
  const res = await dispatch(buildTesterPrompt(params.input)).catch(
    (err): EvaluatorCallResult => ({ content: null, provider: null, model: null, independent: false, failures: [String(err)] })
  );
  if (res.content && res.provider && res.model) {
    await recordLlmCost({ sessionId: params.sessionId, papel: "avaliador", provider: res.provider, model: res.model, usage: res.usage }).catch(() => 0);
  }
  const parsed = parseTesterAnswer(res.content);
  if (!parsed || parsed.testes.length === 0) {
    return { testes: [], julgamento: parsed?.julgamento ?? [], descartados: [{ arquivo: "-", motivo: parsed ? "nenhum teste" : "resposta sem JSON" }] };
  }
  // Teste do teste: contra o projeto ANTES da etapa, todo teste tem de falhar (ou nem carregar: o código não existe).
  const report = await bench(params.projectPath, {
    reproTests: Object.fromEntries(parsed.testes.map((t) => [t.arquivo, t.conteudo])),
    files: parsed.testes.map((t) => `.nextcode-repro/${t.arquivo}`),
  });
  if (!report.ok) return { testes: [], julgamento: parsed.julgamento, descartados: [], bancadaFora: true };
  const descartados: AcceptanceTestSet["descartados"] = [];
  const modifica = (params.input.arquivosExistentes ?? []).length > 0;
  const regressoes = new Set<string>();
  const validos = parsed.testes.filter((t) => {
    const c = classifyRun(report, t.arquivo);
    if (c.status === "passou") {
      if (modifica) {
        regressoes.add(t.arquivo);
        return true;
      }
      descartados.push({ arquivo: t.arquivo, motivo: "já passa sem o código da etapa (não prova nada)" });
      return false;
    }
    return true;
  });
  // Escondido: com 2+ testes do mesmo REQ, o último fica só para o portão (§6 item 6).
  const porReq = new Map<string, number>();
  for (const t of validos) porReq.set(t.req, (porReq.get(t.req) ?? 0) + 1);
  const vistos = new Map<string, number>();
  const testes: AcceptanceTest[] = validos.map((t) => {
    const n = (vistos.get(t.req) ?? 0) + 1;
    vistos.set(t.req, n);
    return {
      req: t.req,
      caminho: t.arquivo,
      conteudo: t.conteudo,
      visivel: !((porReq.get(t.req) ?? 0) >= 2 && n === porReq.get(t.req)),
      ...(regressoes.has(t.arquivo) ? { regressao: true } : {}),
    };
  });
  if (params.sessionId) {
    TelemetryLogger.log({
      sessionId: params.sessionId,
      action: "ACCEPTANCE_TESTS_WRITTEN",
      details: {
        etapa: params.input.microbriefId,
        testes: testes.map((t) => ({ req: t.req, arquivo: t.caminho, visivel: t.visivel, regressao: Boolean(t.regressao) })),
        julgamento: parsed.julgamento,
        descartados,
      },
    });
  }
  return { testes, julgamento: parsed.julgamento, descartados };
}
