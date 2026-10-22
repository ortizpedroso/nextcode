import { TelemetryLogger } from "@/core/telemetry/telemetry-logger";
import { loadRoleSkill, buildSkillSystemPrompt } from "@/core/skills/skill-runtime";
import { fileLineRefExists } from "@/core/governance/dual-lens-auditor";
import { dispatchStrongEvaluator, type EvaluatorCallResult } from "@/core/llm/evaluator-models";
import { recordLlmCost } from "@/core/llm/cost";
import { parseSpecDocument } from "@/core/intake/spec-format";

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
}

export interface FinalReviewResult {
  /** false = a revisão não rodou (não coube, sem modelo, teste sem LLM); nunca reprova sozinha. */
  executado: boolean;
  motivoNaoExecutado?: string;
  aprovado: boolean;
  reqVerdicts: FinalReqVerdict[];
  problemas: FinalProblem[];
  /** Defeitos que reprovam, com o arquivo citado (para a etapa dona) ou sem arquivo (sem dono). */
  defeitos: Array<{ arquivo: string | null; defeito: string }>;
  ressalvas: string[];
  descartes: string[];
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
  dispatchStrongEvaluator(messages, { chain: finalReviewChain(), timeoutMs: 300_000, executorFamily: "deepseek" });

/** Arquivo de uma citação `arquivo:linha` (ou `arquivo:linha-linha`, com texto em volta). */
export function fileOfRef(ref: string): string | null {
  const m = /([\w@./\-[\]()]+\.[A-Za-z0-9]+):\d+/.exec(ref || "");
  return m ? m[1] : null;
}

type Parsed = { ok: true; verdicts: FinalReqVerdict[]; problemas: FinalProblem[]; justificativa: string } | { ok: false; discard: string };

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
  for (const v of verdicts) {
    if (v.status === "implementado" && !fileLineRefExists(v.evidencia, files)) {
      return { ok: false, discard: `${v.id} "implementado" cita "${v.evidencia.slice(0, 120)}", que não existe nos arquivos mostrados` };
    }
  }
  for (const p of problemas) {
    if (p.severidade !== "menor" && !fileLineRefExists(p.arquivoLinha, files)) {
      return { ok: false, discard: `problema ${p.severidade} cita "${p.arquivoLinha.slice(0, 120)}", que não existe nos arquivos mostrados` };
    }
  }
  return {
    ok: true,
    verdicts: verdicts.filter((v) => expectedReqs.length === 0 || expectedReqs.includes(v.id)),
    problemas,
    justificativa: String(parsed.justificativa || "").slice(0, 400),
  };
}

export async function reviewFinalDelivery(input: {
  sessionId?: string;
  spec: string;
  files: Record<string, string>;
  dispatch?: FinalReviewDispatch;
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

  const maxTotal = Number(process.env.FINAL_REVIEW_MAX_TOTAL_CHARS) || 450_000;
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
    (expectedReqs.length > 0 ? ` Julgue CADA requisito da Spec: ${expectedReqs.join(", ")}.` : "") +
    "\n\n[INSTRUÇÕES DECLARATIVAS DA SKILL AVALIADOR-FINAL]\n" +
    skillBlock;
  const filesBlock = Object.entries(input.files)
    .map(([f, c]) => `--- ${f} ---\n${c}`)
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
    const defeitos: FinalReviewResult["defeitos"] = [];
    for (const v of parsed.verdicts) {
      if (v.status === "implementado") continue;
      const ligados = parsed.problemas.filter((p) => p.req === v.id && p.severidade !== "menor").map((p) => `${p.arquivoLinha}: ${p.descricao}`);
      defeitos.push({
        arquivo: fileOfRef(v.evidencia),
        defeito: `revisão final: ${v.id} ${v.status} (${v.evidencia || "sem evidência"})${ligados.length ? ` — ${ligados.join("; ")}` : ""}`,
      });
    }
    for (const p of parsed.problemas.filter((x) => x.severidade === "critico")) {
      if (p.req && defeitos.some((d) => d.defeito.includes(`${p.req} `))) continue;
      defeitos.push({ arquivo: fileOfRef(p.arquivoLinha), defeito: `revisão final [critico] ${p.arquivoLinha}: ${p.descricao}` });
    }
    return {
      executado: true,
      aprovado: defeitos.length === 0,
      reqVerdicts: parsed.verdicts,
      problemas: parsed.problemas,
      defeitos,
      ressalvas: parsed.problemas.filter((p) => p.severidade === "importante").map((p) => `${p.arquivoLinha}: ${p.descricao}`),
      descartes,
      modelo: res.model ?? undefined,
      justificativa: parsed.justificativa,
    };
  }
  return { ...empty(`respostas descartadas: ${descartes.join(" | ")}`), descartes };
}
