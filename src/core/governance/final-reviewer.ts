import { TelemetryLogger } from "@/core/telemetry/telemetry-logger";
import { loadRoleSkill, buildSkillSystemPrompt } from "@/core/skills/skill-runtime";
import { fileLineRefExists } from "@/core/governance/dual-lens-auditor";
import { dispatchStrongEvaluator, type EvaluatorCallResult } from "@/core/llm/evaluator-models";
import { recordLlmCost } from "@/core/llm/cost";
import { parseSpecDocument } from "@/core/intake/spec-format";
import {
  reproduceDefects,
  isProjectTestFile,
  type DefectToReproduce,
  type ReproductionStatus,
  type ReproductionTest,
} from "@/core/governance/defect-reproducer";
import type { TestBenchReport, TestBenchRequest } from "@/core/execution/test-bench";

/**
 * J3 (§5.0/§5.5; mudanças 12 e 17): revisão final cega da entrega. Um modelo forte de outra família do
 * executor (Sonnet 5.5, Opus 5.5 de reserva — medido nos controles) lê a Spec inteira + todos os arquivos entregues e
 * julga cada REQ com arquivo:linha — pega erro de integração entre etapas, que nenhum avaliador de etapa vê.
 * Cego (sem relatório do executor nem vereditos anteriores) e fechado (sem ferramentas). Evidência conferida
 * como a do avaliador de etapa; citação inventada → resposta descartada e pergunta repetida com o motivo.
 * Reprovação → defeitos por arquivo, que viram reparo da etapa dona (J2b).
 */

export const FINAL_REVIEW_MAX_CALLS = 2;

export type FinalReqStatus = "implementado" | "parcial" | "ausente";

export interface FinalReqVerdict {
  id: string;
  status: FinalReqStatus;
  evidencia: string;
}

export interface FinalProblem {
  severidade: "critico" | "importante" | "menor";
  req?: string;
  arquivoLinha: string;
  descricao: string;
  /** Citação que não existe nos arquivos: não some — vira suspeita a reproduzir (ressalva do teste do Antigravity). */
  semCitacao?: boolean;
}

/** Um defeito da revisão final, com a prova da bancada (mudança 43.2). */
export interface FinalDefect {
  arquivo: string | null;
  defeito: string;
  req?: string;
  /** reproduzido = teste falha; sem_prova = leitura sem teste; spec = a Spec é ambígua (ver pergunta). */
  prova?: ReproductionStatus;
  teste?: ReproductionTest;
  saida?: string;
  pergunta?: string;
}

export interface FinalReviewResult {
  /** false = a revisão não rodou (não coube, sem modelo, teste sem LLM); nunca reprova sozinha. */
  executado: boolean;
  motivoNaoExecutado?: string;
  aprovado: boolean;
  reqVerdicts: FinalReqVerdict[];
  problemas: FinalProblem[];
  /** Defeitos que reprovam, com o arquivo citado (para a etapa dona) ou sem arquivo (sem dono). */
  defeitos: FinalDefect[];
  /** Perguntas objetivas sobre a Spec (a revisão não conseguiu testar porque a Spec é ambígua). */
  perguntasSpec?: string[];
  /** Suspeitas que o teste não reproduziu (viram ressalva, não bloqueiam). */
  naoReproduzidos?: string[];
  ressalvas: string[];
  descartes: string[];
  /** REQ que a revisão disse "implementado" com citação inexistente: não contam nem como aprovação nem como defeito. */
  naoVerificados?: string[];
  citacoesInvalidas?: string[];
  modelo?: string;
  justificativa?: string;
}

export type FinalReviewDispatch = (messages: { role: "system" | "user"; content: string }[]) => Promise<EvaluatorCallResult>;

/**
 * Controles de 21/10 (`scripts/controles-avaliador-final-j3.ts`, `docs/relatorios/bench/2026-10-21-j3-controles-avaliador-final.json`):
 * Opus 5.5 e Sonnet 5.5 acertaram 8/8 (P1 correto 5/5; integração, stub e P4 reprovados pelo defeito certo);
 * Sonnet US$ 0,118 × Opus US$ 0,259 → fica o mais barato que passou, Opus de reserva.
 */
function finalReviewChain() {
  return [
    { provider: "claude" as const, model: process.env.FINAL_REVIEW_MODEL || "claude-sonnet-5-5", routedPrefixes: ["anthropic/"] },
    { provider: "claude" as const, model: process.env.FINAL_REVIEW_RESERVE_MODEL || "claude-opus-5-5", routedPrefixes: ["anthropic/"] },
  ];
}

const defaultDispatch: FinalReviewDispatch = (messages) =>
  // Gateway real (22/10, ~150 mil tokens): com 8000 de teto o Sonnet gastou tudo pensando (stop_reason=max_tokens).
  dispatchStrongEvaluator(messages, {
    chain: finalReviewChain(),
    timeoutMs: 600_000,
    maxTokens: Number(process.env.FINAL_REVIEW_MAX_TOKENS) || 32_000,
    executorFamily: "deepseek",
  });

/** Arquivo de uma citação `arquivo:linha` (ou `arquivo:linha-linha`, com texto em volta). */
export function fileOfRef(ref: string): string | null {
  const m = /([\w@./\-[\]()]+\.[A-Za-z0-9]+):\d+/.exec(ref || "");
  // "(src/a.ts:1)": o parêntese do texto entra no casamento; pastas "(grupo)" do Next nunca começam o caminho.
  return m ? m[1].replace(/^\(+/, "") : null;
}

type Parsed =
  | { ok: true; verdicts: FinalReqVerdict[]; problemas: FinalProblem[]; justificativa: string; naoVerificados: string[]; citacoesInvalidas: string[] }
  | { ok: false; discard: string };

/** Acima desta fração de itens com citação que não existe, a resposta inteira é descartada (alucinação). */
export const FINAL_REVIEW_MAX_INVALID_FRACTION = 0.2;

/**
 * Citação do avaliador final: o arquivo existe e a linha inicial está nele; o fim do intervalo que passa do
 * fim do arquivo é cortado no fim (Gateway real, 22/10: `tenant.ts:15-25` com 24 linhas e `middleware.ts:95-120`
 * com 119 — contagem imprecisa num contexto de 150 mil tokens, não invenção).
 */
export function finalRefExists(ref: string, files: Record<string, string>): boolean {
  const m = /([A-Za-z0-9_./@[\]()-]+\.[A-Za-z0-9]+):(\d+)(?:-(\d+))?/.exec(String(ref || ""));
  if (!m) return false;
  const start = Number(m[2]);
  const end = m[3] ? Number(m[3]) : start;
  if (start < 1 || end < start) return false;
  const content = files[m[1]] ?? Object.entries(files).find(([k]) => k.replace(/\\/g, "/") === m[1])?.[1];
  if (content === undefined) return false;
  const total = content.split(/\r?\n/).length;
  return start <= total && fileLineRefExists(`${m[1]}:${start}-${Math.min(end, total)}`, files);
}

export function parseFinalReview(raw: string | null, expectedReqs: string[], files: Record<string, string>): Parsed {
  if (!raw) return { ok: false, discard: "avaliador final sem resposta" };
  const match = raw.match(/\{[\s\S]*"aprovado"\s*:\s*(?:true|false)[\s\S]*\}/i);
  if (!match) return { ok: false, discard: 'resposta sem o JSON pedido (campo "aprovado")' };
  let parsed: any;
  try {
    parsed = JSON.parse(match[0]);
  } catch (err) {
    return { ok: false, discard: `JSON inválido (${String(err).slice(0, 120)})` };
  }
  const verdicts: FinalReqVerdict[] = Array.isArray(parsed.reqVerdicts)
    ? parsed.reqVerdicts.map((r: any) => ({
        id: String(r?.id || ""),
        status: (["implementado", "parcial", "ausente"].includes(r?.status) ? r.status : "ausente") as FinalReqStatus,
        evidencia: String(r?.evidencia || ""),
      }))
    : [];
  const got = new Set(verdicts.map((v) => v.id));
  const faltando = expectedReqs.filter((id) => !got.has(id));
  if (faltando.length > 0) return { ok: false, discard: `faltou o veredito de ${faltando.join(", ")} em "reqVerdicts"` };
  const problemas: FinalProblem[] = Array.isArray(parsed.problemas)
    ? parsed.problemas
        .filter((p: any) => p && ["critico", "importante", "menor"].includes(p.severidade))
        .map((p: any) => ({
          severidade: p.severidade,
          req: p.req ? String(p.req) : undefined,
          arquivoLinha: String(p.arquivoLinha || ""),
          descricao: String(p.descricao || "").slice(0, 600),
        }))
    : [];
  // Citação inválida isolada desqualifica só o item: "implementado" vira não verificado (a T10 já aprovou o REQ)
  // e o problema sai da lista. Muitas inválidas → a resposta inteira é descartada.
  const invalidas: string[] = [];
  const naoVerificados: string[] = [];
  for (const v of verdicts) {
    if (v.status === "implementado" && !finalRefExists(v.evidencia, files)) {
      invalidas.push(`${v.id} "implementado" cita "${v.evidencia.slice(0, 120)}"`);
      naoVerificados.push(v.id);
    }
  }
  const problemasValidos = problemas.filter((p) => {
    if (p.severidade === "menor" || finalRefExists(p.arquivoLinha, files)) return true;
    invalidas.push(`problema ${p.severidade} cita "${p.arquivoLinha.slice(0, 120)}"`);
    // Crítico com citação errada não some (o teste independente apontou que sumir deixava de reprovar):
    // vira suspeita sem citação, e a bancada decide se o defeito existe.
    if (p.severidade === "critico") {
      p.semCitacao = true;
      return true;
    }
    return false;
  });
  const itens = verdicts.length + problemas.filter((p) => p.severidade !== "menor").length;
  if (invalidas.length > 0 && invalidas.length > Math.max(1, Math.floor(itens * FINAL_REVIEW_MAX_INVALID_FRACTION))) {
    return {
      ok: false,
      discard: `${invalidas.length} de ${itens} citações não existem nos arquivos mostrados (ex.: ${invalidas.slice(0, 3).join("; ")})`,
    };
  }
  return {
    ok: true,
    verdicts: verdicts.filter((v) => (expectedReqs.length === 0 || expectedReqs.includes(v.id)) && !naoVerificados.includes(v.id)),
    problemas: problemasValidos,
    justificativa: String(parsed.justificativa || "").slice(0, 400),
    naoVerificados,
    citacoesInvalidas: invalidas,
  };
}

export async function reviewFinalDelivery(input: {
  sessionId?: string;
  spec: string;
  files: Record<string, string>;
  dispatch?: FinalReviewDispatch;
  /** Mudança 43.2: pasta do projeto para a bancada reproduzir cada defeito; sem ela, só leitura (como antes). */
  projectPath?: string | null;
  /** Injeções para teste: quem escreve o teste de reprodução e a bancada. */
  reproDispatch?: FinalReviewDispatch;
  bench?: (projectPath: string, req: TestBenchRequest) => Promise<TestBenchReport>;
}): Promise<FinalReviewResult> {
  const empty = (motivo: string): FinalReviewResult => ({
    executado: false,
    motivoNaoExecutado: motivo,
    aprovado: true,
    reqVerdicts: [],
    problemas: [],
    defeitos: [],
    ressalvas: [],
    descartes: [],
  });
  if (!input.dispatch && process.env.NODE_ENV === "test") return empty("teste sem LLM (dispatch não injetado)");

  // Sonnet 5.5 e Opus 5.5: 1 milhão de tokens de entrada; 1,2 milhão de caracteres ≈ 350 mil tokens (folga para skill e resposta).
  const maxTotal = Number(process.env.FINAL_REVIEW_MAX_TOTAL_CHARS) || 1_200_000;
  const total = input.spec.length + Object.values(input.files).reduce((n, c) => n + c.length, 0);
  if (total > maxTotal) return empty(`não coube: ${total} caracteres (máximo ${maxTotal})`);

  const expectedReqs = parseSpecDocument(input.spec)?.requisitosIds ?? [];
  let skillBlock = "";
  try {
    skillBlock = buildSkillSystemPrompt(loadRoleSkill("avaliador-final"), {});
  } catch {
    skillBlock = "";
  }
  const system =
    "Você é o avaliador final cego do projeto. Siga as instruções da skill abaixo. Responda SOMENTE com o JSON pedido." +
    ' Cada linha dos arquivos vem numerada ("12| código"): cite arquivo:linha por esse número; o prefixo não faz parte do código.' +
    (expectedReqs.length > 0 ? ` Julgue CADA requisito da Spec: ${expectedReqs.join(", ")}.` : "") +
    "\n\n[INSTRUÇÕES DECLARATIVAS DA SKILL AVALIADOR-FINAL]\n" +
    skillBlock;
  // Linhas numeradas ("12| ") só para citar com precisão; o número não faz parte do código.
  const filesBlock = Object.entries(input.files)
    .map(([f, c]) => `--- ${f} ---\n${c.split(/\r?\n/).map((l, i) => `${i + 1}| ${l}`).join("\n")}`)
    .join("\n\n");
  const dispatch = input.dispatch ?? defaultDispatch;
  const descartes: string[] = [];

  for (let call = 1; call <= FINAL_REVIEW_MAX_CALLS; call++) {
    const previous = descartes[descartes.length - 1];
    const res = await dispatch([
      { role: "system", content: system },
      {
        role: "user",
        content:
          `[SPEC CANÔNICA]\n${input.spec}\n\n[ARQUIVOS GERADOS]\n${filesBlock}` +
          (previous ? `\n\n[SUA RESPOSTA ANTERIOR FOI DESCARTADA] Motivo: ${previous}. Responda de novo no formato pedido, corrigindo isso.` : ""),
      },
    ]).catch((err): EvaluatorCallResult => ({ content: null, provider: null, model: null, independent: false, failures: [String(err)] }));
    if (res.content && res.provider && res.model) {
      await recordLlmCost({ sessionId: input.sessionId, papel: "avaliador", provider: res.provider, model: res.model, usage: res.usage }).catch(() => 0);
    }
    for (const w of res.wastedUsage ?? []) {
      await recordLlmCost({ sessionId: input.sessionId, papel: "avaliador", provider: "claude", model: w.model, usage: w.usage }).catch(() => 0);
    }
    if (!res.content) {
      return { ...empty(`sem modelo: ${res.failures.slice(0, 3).join(" | ") || "sem resposta"}`), descartes };
    }
    const parsed = parseFinalReview(res.content, expectedReqs, input.files);
    if (!parsed.ok) {
      descartes.push(parsed.discard);
      if (input.sessionId) {
        TelemetryLogger.log({ sessionId: input.sessionId, action: "FINAL_REVIEW_DISCARDED", details: { chamada: call, motivo: parsed.discard } });
      }
      continue;
    }
    let defeitos: FinalDefect[] = [];
    for (const v of parsed.verdicts) {
      if (v.status === "implementado") continue;
      const ligados = parsed.problemas.filter((p) => p.req === v.id && p.severidade !== "menor").map((p) => `${p.arquivoLinha}: ${p.descricao}`);
      defeitos.push({
        req: v.id,
        arquivo: fileOfRef(v.evidencia),
        defeito: `revisão final: ${v.id} ${v.status} (${v.evidencia || "sem evidência"})${ligados.length ? ` — ${ligados.join("; ")}` : ""}`,
      });
    }
    for (const p of parsed.problemas.filter((x) => x.severidade === "critico")) {
      if (p.req && defeitos.some((d) => d.defeito.includes(`${p.req} `))) continue;
      defeitos.push({
        req: p.req,
        arquivo: p.semCitacao ? null : fileOfRef(p.arquivoLinha),
        defeito: `revisão final [critico]${p.semCitacao ? " (citação inexistente)" : ""} ${p.arquivoLinha}: ${p.descricao}`,
      });
    }

    // Mudança 43.2: cada defeito é provado na bancada antes de ir para o reparo.
    const ressalvasExtras: string[] = [];
    const naoReproduzidos: string[] = [];
    const perguntasSpec: string[] = [];
    // Os testes do próprio projeto rodam sempre (sem LLM): a leitura varia de uma rodada para outra, o
    // teste não (Gateway 22/10: o REQ-055 sumiu de uma revisão, mas o teste do parcelamento seguia falhando).
    const projectTests = input.projectPath
      ? Object.keys(input.files).filter((f) => isProjectTestFile(f) && !defeitos.some((d) => d.arquivo === f))
      : [];
    if (input.projectPath && (defeitos.length > 0 || projectTests.length > 0)) {
      const toReproduce: DefectToReproduce[] = [
        ...defeitos.map((d, i) => ({ id: `D${i + 1}`, req: d.req, arquivo: d.arquivo, defeito: d.defeito })),
        ...projectTests.map((f, i) => ({ id: `T${i + 1}`, arquivo: f, defeito: `teste do projeto ${f}` })),
      ];
      const reproResults = await reproduceDefects({
        sessionId: input.sessionId,
        projectPath: input.projectPath,
        spec: input.spec,
        files: input.files,
        defects: toReproduce,
        dispatch: input.reproDispatch,
        bench: input.bench,
      });
      const kept: FinalDefect[] = [];
      defeitos.forEach((d, i) => {
        const r = reproResults[i];
        if (r.status === "nao_reproduzido") {
          naoReproduzidos.push(d.defeito);
          ressalvasExtras.push(`suspeita não reproduzida por teste: ${d.defeito.slice(0, 300)}`);
          return;
        }
        if (r.status === "spec") {
          perguntasSpec.push(`${d.req ?? "Spec"}: ${r.motivo ?? ""}`);
          kept.push({ ...d, arquivo: null, prova: "spec", pergunta: r.motivo });
          return;
        }
        kept.push({
          ...d,
          arquivo: r.arquivoCorrecao ?? d.arquivo,
          prova: r.status,
          ...(r.teste ? { teste: r.teste } : {}),
          ...(r.saida ? { saida: r.saida } : {}),
        });
      });
      projectTests.forEach((f, i) => {
        const r = reproResults[defeitos.length + i];
        if (r.status !== "reproduzido") return; // passou (ou bancada fora): nada a dizer
        kept.push({
          arquivo: r.arquivoCorrecao ?? f,
          defeito: `teste do projeto falha: ${f} — ${(r.saida ?? "").split("\n")[0].slice(0, 300)}`,
          prova: "reproduzido",
          ...(r.teste ? { teste: r.teste } : {}),
          ...(r.saida ? { saida: r.saida } : {}),
        });
      });
      defeitos = kept;
    }
    return {
      executado: true,
      aprovado: defeitos.length === 0,
      ...(perguntasSpec.length ? { perguntasSpec } : {}),
      ...(naoReproduzidos.length ? { naoReproduzidos } : {}),
      reqVerdicts: parsed.verdicts,
      problemas: parsed.problemas,
      defeitos,
      ressalvas: [
        ...parsed.problemas.filter((p) => p.severidade === "importante").map((p) => `${p.arquivoLinha}: ${p.descricao}`),
        ...ressalvasExtras,
      ],
      descartes,
      naoVerificados: parsed.naoVerificados,
      citacoesInvalidas: parsed.citacoesInvalidas,
      modelo: res.model ?? undefined,
      justificativa: parsed.justificativa,
    };
  }
  return { ...empty(`respostas descartadas: ${descartes.join(" | ")}`), descartes };
}
