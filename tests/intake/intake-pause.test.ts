import { describe, expect, it } from "vitest";
import {
  approveReasonFromIntakePausa,
  ConferentePausaMsg,
  intakePausaCodigoFromConferenteMsg,
} from "@/core/intake/intake-pause";
import { messageForApproveSpecFailure } from "@/core/intake/approve-spec-messages";

describe("intake pause — tratamento da mensagem", () => {
  it("laudo JSON inválido → pausa operacional, não PERGUNTA_AO_HUMANO de cluster", () => {
    expect(intakePausaCodigoFromConferenteMsg(ConferentePausaMsg.LAUDO_JSON_INVALIDO)).toBe(
      "CONFERENTE_LAUDO_JSON_INVALIDO"
    );
    expect(approveReasonFromIntakePausa("CONFERENTE_LAUDO_JSON_INVALIDO")).toBe("CONFERENCIA_LLM_INDISPONIVEL");
    const msg = messageForApproveSpecFailure("CONFERENCIA_LLM_INDISPONIVEL", [ConferentePausaMsg.LAUDO_JSON_INVALIDO], {
      pausaCodigo: "CONFERENTE_LAUDO_JSON_INVALIDO",
    });
    expect(msg).toContain("pausa operacional");
    expect(msg).toContain("não");
    expect(msg).not.toContain("nomeando cluster");
  });
});
