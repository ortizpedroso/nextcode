import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  verifyProjectDeliveryWithJev,
  DELIVERY_AUDIT_QUESTIONS,
} from "../../src/core/decision/jev-execution-checks.js";
import * as jevClient from "../../src/core/decision/jev.js";
import { TelemetryLogger } from "../../src/core/telemetry/telemetry-logger.js";
import {
  renderDeliveryAuditReportMarkdown,
  renderMicrobriefReparoMarkdown,
  type DeliveryAuditReportDocument,
  type MicrobriefReparoDocument,
} from "../../src/core/templates/artifact-templates.js";

describe("Auditoria Final de Entrega pelo JEV (Spec Canônica × Código Real no Disco)", () => {
  const dummySpec = {
    titulo: "SaaS de Gestão de Leads",
    versao: 1,
    stack: ["Fastify", "TypeScript", "Prisma"],
    regras: ["Segredos restritos ao servidor", "Não permitir lead duplicado"],
    arquivosAfetados: ["src/services/lead.service.ts", "src/routes/lead.routes.ts"],
    requisitos: [
      { id: "REQ-001", titulo: "Criar Lead", criterio: "Valida e salva lead no banco" },
      { id: "REQ-002", titulo: "Deduplicar Lead", criterio: "Verifica e rejeita emails já cadastrados" },
      { id: "REQ-003", titulo: "Disparar Webhook", criterio: "Envia payload assinado via HMAC" },
    ],
  };

  const dummyCodeMap = {
    "src/services/lead.service.ts": `
      export class LeadService {
        async create(data: { email: string; name: string }) {
          if (await this.exists(data.email)) throw new Error("Duplicado");
          return { id: "1", ...data };
        }
        async exists(email: string) { return false; }
        async dispatchWebhook(lead: any) { /* assina hmac */ }
      }
    `,
    "src/routes/lead.routes.ts": `
      export function leadRoutes(app: any) {
        app.post("/leads", async (req, reply) => {
          return reply.send({ ok: true });
        });
      }
    `,
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("deve conter exatamente 6 perguntas estratégicas Fan-Out para auditoria de entrega", () => {
    const keys = Object.keys(DELIVERY_AUDIT_QUESTIONS);
    expect(keys).toHaveLength(6);
    expect(keys).toEqual([
      "requisitos_integralmente_implementados",
      "fidelidade_regras_negocio",
      "ausencia_stubs_e_placeholders",
      "aderencia_stack_e_contratos",
      "isolamento_seguranca_e_segredos",
      "integracao_e_consistencia_entre_arquivos",
    ]);
  });

  it("deve aprovar entrega quando todos os scores do JEV forem superiores aos limiares", async () => {
    vi.spyOn(jevClient, "askJevBatch").mockResolvedValue({
      requisitos_integralmente_implementados: { type: "noul", noul: 0.96, confidence: 0.96 },
      fidelidade_regras_negocio: { type: "noul", noul: 0.94, confidence: 0.94 },
      ausencia_stubs_e_placeholders: { type: "noul", noul: 0.92, confidence: 0.92 },
      aderencia_stack_e_contratos: { type: "noul", noul: 0.90, confidence: 0.90 },
      isolamento_seguranca_e_segredos: { type: "noul", noul: 0.95, confidence: 0.95 },
      integracao_e_consistencia_entre_arquivos: { type: "noul", noul: 0.89, confidence: 0.89 },
    });

    const logSpy = vi.spyOn(TelemetryLogger, "log");

    const result = await verifyProjectDeliveryWithJev({
      sessionId: "session-delivery-ok",
      projetoId: "SaaS de Gestão de Leads",
      spec: dummySpec,
      codeContentMap: dummyCodeMap,
    });

    expect(result.aprovado).toBe(true);
    expect(result.jevDisponivel).toBe(true);
    expect(result.lacunas).toHaveLength(0);
    expect(result.confiancaMedia).toBeGreaterThan(0.90);
    expect(result.resumoAuditoria).toContain("atende rigorosamente");

    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "JEV_FINAL_DELIVERY_AUDIT",
        details: expect.objectContaining({
          aprovado: true,
          jevDisponivel: true,
        }),
      })
    );
  });

  it("deve reprovar entrega quando houver stubs/TODOs e omissão de requisitos", async () => {
    vi.spyOn(jevClient, "askJevBatch").mockResolvedValue({
      requisitos_integralmente_implementados: { type: "noul", noul: 0.65, confidence: 0.65 }, // falha (< 0.85)
      fidelidade_regras_negocio: { type: "noul", noul: 0.90, confidence: 0.90 },
      ausencia_stubs_e_placeholders: { type: "noul", noul: 0.60, confidence: 0.60 }, // falha (< 0.85)
      aderencia_stack_e_contratos: { type: "noul", noul: 0.85, confidence: 0.85 },
      isolamento_seguranca_e_segredos: { type: "noul", noul: 0.85, confidence: 0.85 },
      integracao_e_consistencia_entre_arquivos: { type: "noul", noul: 0.85, confidence: 0.85 },
    });

    const result = await verifyProjectDeliveryWithJev({
      sessionId: "session-delivery-fail",
      projetoId: "SaaS de Gestão de Leads",
      spec: dummySpec,
      codeContentMap: dummyCodeMap,
    });

    expect(result.aprovado).toBe(false);
    expect(result.jevDisponivel).toBe(true);
    expect(result.lacunas).toHaveLength(2);
    expect(result.lacunas[0].categoria).toBe("requisito_faltante");
    expect(result.lacunas[0].descricao).toContain("score: 0.65");
    expect(result.lacunas[1].categoria).toBe("stub_ou_placeholder");
    expect(result.lacunas[1].descricao).toContain("score: 0.60");
  });

  it("deve renderizar o Laudo de Auditoria de Entrega formal em Markdown + YAML", () => {
    const laudoDoc: DeliveryAuditReportDocument = {
      documento: "laudo_auditoria_entrega",
      idLaudo: "laudo-101",
      idProjeto: "SaaS de Gestão de Leads",
      specVersao: 1,
      aprovado: false,
      confiancaMedia: 0.72,
      scores: {
        requisitosImplementados: 0.65,
        fidelidadeRegras: 0.90,
        ausenciaStubs: 0.60,
        aderenciaContratos: 0.85,
        isolamentoSeguranca: 0.85,
        integracaoArquivos: 0.85,
      },
      lacunas: [
        {
          categoria: "requisito_faltante",
          reqId: "REQ-003",
          arquivo: "src/services/lead.service.ts",
          descricao: "Webhook com assinatura HMAC não foi implementado.",
        },
      ],
      resumoAuditoria: "Auditoria reprovada com 1 lacuna.",
    };

    const md = renderDeliveryAuditReportMarkdown(laudoDoc);

    expect(md.startsWith("---\n")).toBe(true);
    expect(md).toContain("documento: laudo_auditoria_entrega");
    expect(md).toContain("id: \"laudo-101\"");
    expect(md).toContain("aprovado: false");
    expect(md).toContain("scores:");
    expect(md).toContain("requisitos_implementados: 0.65");
    expect(md).toContain("# Laudo de Auditoria Final de Entrega — SaaS de Gestão de Leads");
    expect(md).toContain("❌ REPROVADO — LACUNAS DETECTADAS");
    expect(md).toContain("[requisito_faltante] [REQ-003] em `src/services/lead.service.ts`");
    expect(md).toContain("Webhook com assinatura HMAC não foi implementado.");
  });

  it("deve renderizar o Microbrief de Reparo em Markdown + YAML para o Executor com isolamento de Spec", () => {
    const reparoDoc: MicrobriefReparoDocument = {
      documento: "microbrief_reparo",
      idReparo: "REPARO-LEAD-V1",
      referenciaEtapaOriginal: "etapa-lead-services",
      versaoReparo: 1,
      idProjeto: "SaaS de Gestão de Leads",
      filesScope: ["src/services/lead.service.ts"],
      reqsAlvo: ["REQ-003"],
      diretrizCirurgica: "Implementar estritamente o método dispatchWebhook com assinatura HMAC sem alterar os outros métodos.",
      lacunasParaSanar: ["Webhook com assinatura HMAC não foi implementado."],
      contratosEsperados: "export interface WebhookPayload { event: string; signature: string; }",
    };

    const md = renderMicrobriefReparoMarkdown(reparoDoc);

    expect(md.startsWith("---\n")).toBe(true);
    expect(md).toContain("documento: microbrief_reparo");
    expect(md).toContain("id_reparo: \"REPARO-LEAD-V1\"");
    expect(md).toContain("referencia_etapa: \"etapa-lead-services\"");
    expect(md).toContain("files_scope:");
    expect(md).toContain("- \"src/services/lead.service.ts\"");
    expect(md).toContain("reqs_alvo:");
    expect(md).toContain("- REQ-003");
    expect(md).toContain("# Microbrief de Reparo: REPARO-LEAD-V1");
    expect(md).toContain("Diretriz Cirúrgica de Execução");
    expect(md).toContain("Implementar estritamente o método dispatchWebhook");
    expect(md).toContain("```typescript");
    expect(md).toContain("export interface WebhookPayload");
  });
});
