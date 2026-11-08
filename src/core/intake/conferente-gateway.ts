/**
 * Chamada LLM do conferente-macrobrief — contrato JSON de plataforma (Trava T1 / conferência de entrada).
 * Centraliza retry, response_format json_object e parse do laudo.
 */

import prisma from "@/lib/prisma";
import { loadRoleSkill, buildSkillSystemPrompt } from "@/core/skills/skill-runtime";
import { SmartRouter, type DispatchMessage } from "@/core/router/smart-router";
import { readSecret } from "@/core/security/crypto";
import { textoParaOConferente } from "@/core/intake/macrobrief-elicitador";
import {
  parseConferenteLaudoFromCompletion,
  type ConferenteLaudo,
} from "@/core/intake/conferente-laudo";
import {
  ConferentePausaMsg,
  type IntakePausaCodigo,
  intakePausaCodigoFromConferenteMsg,
} from "@/core/intake/intake-pause";

export type ConferenteInvokeResult =
  | { ok: true; laudo: ConferenteLaudo }
  | { ok: false; pausaCodigo: IntakePausaCodigo; problem: string };

const JSON_RETRY_USER =
  "Responda SOMENTE com um objeto JSON válido contendo as chaves `aprovado`, `falhas` e `incertos`. " +
  "Sem markdown, sem texto antes ou depois do JSON.";

/**
 * Produz laudo do conferente (tier heavy + json_object nos gateways que suportam).
 * Não reprova conteúdo da Spec: falhas operacionais retornam pausaSemTentativa upstream.
 */
export async function invokeConferenteMacrobrief(
  sessionId: string,
  specText: string,
  macrobriefTexto: string
): Promise<ConferenteInvokeResult> {
  const conferenteSkill = loadRoleSkill("conferente-macrobrief");
  const conferenteSystemPrompt = buildSkillSystemPrompt(conferenteSkill, { includeLocalReferences: true });
  const conferenteUserBase = textoParaOConferente(specText, macrobriefTexto);

  const attempts: DispatchMessage[][] = [
    [
      { role: "system", content: conferenteSystemPrompt },
      { role: "user", content: conferenteUserBase },
    ],
    [
      { role: "system", content: conferenteSystemPrompt },
      { role: "user", content: conferenteUserBase },
      { role: "user", content: JSON_RETRY_USER },
    ],
  ];

  const setting = await prisma.setting.findUnique({ where: { id: "default" } });
  const smartRouter = new SmartRouter();

  let lastProblem: string = ConferentePausaMsg.MODELO_INDISPONIVEL;
  let lastCodigo: IntakePausaCodigo = "CONFERENTE_MODELO_INDISPONIVEL";

  try {
    for (let attempt = 0; attempt < attempts.length; attempt++) {
      const dispatchRes = await smartRouter.dispatchWithFallback({
        messages: attempts[attempt]!,
        tier: "heavy",
        geminiKey: readSecret(setting?.geminiKey),
        stream: false,
        sessionId,
        responseFormat: { type: "json_object" },
        gatewayTimeoutMs: Number(process.env.LLM_CONFERENTE_TIMEOUT_MS) || 180000,
      });

      if (!dispatchRes) {
        lastProblem = ConferentePausaMsg.MODELO_INDISPONIVEL;
        lastCodigo = "CONFERENTE_MODELO_INDISPONIVEL";
        break;
      }

      const resJson = await dispatchRes.response.json().catch(() => ({}));
      const parsed = parseConferenteLaudoFromCompletion(resJson);
      if (parsed.ok) {
        return { ok: true, laudo: parsed.laudo };
      }

      if (parsed.candidates === 0) {
        lastProblem = ConferentePausaMsg.LAUDO_VAZIO;
        lastCodigo = "CONFERENTE_LAUDO_VAZIO";
      } else {
        lastProblem = ConferentePausaMsg.LAUDO_JSON_INVALIDO;
        lastCodigo = "CONFERENTE_LAUDO_JSON_INVALIDO";
      }
    }
  } catch (err) {
    console.warn("[INTAKE] Exceção ao chamar conferente-macrobrief:", err);
    lastProblem = ConferentePausaMsg.MODELO_INDISPONIVEL;
    lastCodigo = "CONFERENTE_MODELO_INDISPONIVEL";
  }

  return {
    ok: false,
    pausaCodigo: lastCodigo ?? intakePausaCodigoFromConferenteMsg(lastProblem) ?? "CONFERENTE_MODELO_INDISPONIVEL",
    problem: lastProblem,
  };
}
