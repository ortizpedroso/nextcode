import { describe, it, expect, vi, beforeEach } from "vitest";
import { IntakeEngine } from "../../src/core/intake/intake-engine.js";
import { renderCanonicalSpecDocument } from "../../src/core/intake/spec-format.js";
import { SpecDecomposerSkill } from "../../src/core/skills/spec-decomposer.js";
import { renderMacrobriefMarkdown } from "../../src/core/templates/artifact-templates.js";
import * as jevClient from "../../src/core/decision/jev.js";
import * as jevExecutionChecks from "../../src/core/decision/jev-execution-checks.js";

describe("Teste Pesado de Estresse: SaaS Completo, Decomposição Real e Conferência Fan-Out do JEV", () => {
  // Spec pesada de um SaaS multi-tenant completo com 4 módulos e 4 arquivos
  const saasSpecDoc = renderCanonicalSpecDocument({
    titulo: "SaaS Multi-tenant de Faturamento e Cobrança",
    status: "aprovada",
    data: "2026-10-10",
    stack: ["Fastify", "TypeScript", "Prisma", "PostgreSQL"],
    modulos: [
      {
        id: "mod-auth",
        nome: "Autenticação e Multi-tenancy",
        resumo: "Gerencia login, JWT e resolução de tenant",
        arquivos: ["src/modules/auth/auth.service.ts"],
      },
      {
        id: "mod-clientes",
        nome: "Cadastro de Clientes",
        resumo: "CRUD de clientes vinculados ao tenant",
        arquivos: ["src/modules/clientes/clientes.repo.ts"],
      },
      {
        id: "mod-faturamento",
        nome: "Motor de Faturas",
        resumo: "Geração de faturas e cálculo de juros/descontos",
        arquivos: ["src/modules/faturamento/fatura.service.ts"],
      },
      {
        id: "mod-webhook",
        nome: "Disparo de Webhooks de Pagamento",
        resumo: "Assina eventos e entrega payloads para o cliente",
        arquivos: ["src/modules/webhook/webhook.worker.ts"],
      },
    ],
    entidades: [
      {
        nome: "Tenant",
        campos: [
          { nome: "id", tipo: "string" },
          { nome: "nome", tipo: "string" },
        ],
      },
      {
        nome: "Fatura",
        campos: [
          { nome: "id", tipo: "string" },
          { nome: "valorCentavos", tipo: "number" },
          { nome: "status", tipo: "string" },
        ],
      },
    ],
    arquivosAfetados: [
      "src/modules/auth/auth.service.ts",
      "src/modules/clientes/clientes.repo.ts",
      "src/modules/faturamento/fatura.service.ts",
      "src/modules/webhook/webhook.worker.ts",
    ],
    objetivo: "SaaS completo e seguro de faturamento com isolamento de tenant, cálculo preciso de faturas e envio resiliente de webhooks.",
    notasImplementacao: [
      "Obrigatoriamente validar o tenantId em todas as queries",
      "Nunca expor chaves de webhook ou senhas em respostas da API",
      "Garantir idempotência na entrega de webhooks",
    ],
    requisitosIds: ["REQ-001", "REQ-002", "REQ-003", "REQ-004"],
    requisitos: [
      {
        id: "REQ-001",
        titulo: "Autenticação Multi-tenant",
        criterio: "src/modules/auth/auth.service.ts resolve tenantId a partir do token JWT e rejeita acessos não autorizados.",
      },
      {
        id: "REQ-002",
        titulo: "Repositório de Clientes",
        criterio: "src/modules/clientes/clientes.repo.ts isola os registros de clientes por tenantId.",
      },
      {
        id: "REQ-003",
        titulo: "Motor de Faturas",
        criterio: "src/modules/faturamento/fatura.service.ts calcula juros diários e emite faturas com status pendente.",
      },
      {
        id: "REQ-004",
        titulo: "Worker de Webhook",
        criterio: "src/modules/webhook/webhook.worker.ts assina o payload via HMAC-SHA256 e registra tentativas de reenvio.",
      },
    ],
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("deve decompor a Spec pesada gerando Macrobrief em Markdown + YAML e passar na conferência de 6 perguntas do JEV", async () => {
    // 1. Simula respostas de alta confiança do JEV para o SaaS
    vi.spyOn(jevClient, "askJevBatch").mockResolvedValue({
      cobertura_requisitos: { type: "noul", noul: 0.95, confidence: 0.95 },
      fidelidade_sem_contradicao: { type: "noul", noul: 0.94, confidence: 0.94 },
      sem_escopo_inventado: { type: "noul", noul: 0.91, confidence: 0.91 },
      suficiencia_arquivos: { type: "noul", noul: 0.89, confidence: 0.89 },
      ordem_dependencias_valida: { type: "noul", noul: 0.93, confidence: 0.93 },
      isolamento_seguranca: { type: "noul", noul: 0.97, confidence: 0.97 },
    });

    // 2. Executa a decomposição real
    const decomp = SpecDecomposerSkill.decomposeSpec(
      saasSpecDoc,
      "SaaS Multi-tenant de Faturamento e Cobrança",
      [
        "src/modules/auth/auth.service.ts",
        "src/modules/clientes/clientes.repo.ts",
        "src/modules/faturamento/fatura.service.ts",
        "src/modules/webhook/webhook.worker.ts",
      ],
      ["Fastify", "TypeScript", "Prisma", "PostgreSQL"],
      "sessao-saas-pesada"
    );

    expect(decomp.macrobrief).not.toBeNull();
    expect(decomp.macrobrief!.microbriefs.length).toBeGreaterThanOrEqual(1);

    // 3. Renderiza o Macrobrief em Markdown + YAML
    const macrobriefMd = renderMacrobriefMarkdown(decomp.macrobrief!);
    expect(macrobriefMd.startsWith("---\n")).toBe(true);
    expect(macrobriefMd).toContain("documento: macrobrief");
    expect(macrobriefMd).toContain("requisitos_totais:");
    expect(macrobriefMd).toContain("REQ-001");
    expect(macrobriefMd).toContain("REQ-004");
    expect(macrobriefMd).toContain("# Macrobrief:");

    // 4. Executa o ciclo de intake com conferência do JEV
    const cycleResult = await IntakeEngine.runElicitadorAndAnalistaCycle({
      sessionId: "sessao-saas-pesada",
      initialSpec: saasSpecDoc,
    });

    expect(cycleResult.ok).toBe(true);
    expect(cycleResult.finalPhaseContext.phase).toBe("PLANEJAMENTO");
    expect(cycleResult.finalPhaseContext.voltasConferencia).toBe(0);
    expect(cycleResult.problems).toHaveLength(0);
    expect(cycleResult.microbriefs).toBeDefined();
    expect(cycleResult.microbriefs!.length).toBeGreaterThan(0);
  });

  it("deve detectar e barrar no JEV se o Macrobrief omitir isolamento de segurança ou inventar escopo", async () => {
    // JEV reprova em 2 critérios cruciais: isolamento de segurança e escopo inventado
    vi.spyOn(jevClient, "askJevBatch").mockResolvedValue({
      cobertura_requisitos: { type: "noul", noul: 0.90, confidence: 0.90 },
      fidelidade_sem_contradicao: { type: "noul", noul: 0.90, confidence: 0.90 },
      sem_escopo_inventado: { type: "noul", noul: 0.65, confidence: 0.65 }, // falha (< 0.80)
      suficiencia_arquivos: { type: "noul", noul: 0.85, confidence: 0.85 },
      ordem_dependencias_valida: { type: "noul", noul: 0.85, confidence: 0.85 },
      isolamento_seguranca: { type: "noul", noul: 0.50, confidence: 0.50 }, // falha grave (< 0.80)
    });

    let repairCalls = 0;
    const onRepairCycle = vi.fn().mockImplementation((cycle, culprit, problems, currentSpec) => {
      repairCalls++;
      expect(culprit).toBe("macrobrief");
      expect(problems.some((p: string) => p.includes("Risco de segurança/isolamento"))).toBe(true);
      expect(problems.some((p: string) => p.includes("Invenção de escopo"))).toBe(true);
      return currentSpec;
    });

    const cycleResult = await IntakeEngine.runElicitadorAndAnalistaCycle({
      sessionId: "sessao-saas-pesada-falha",
      initialSpec: saasSpecDoc,
      onRepairCycle,
    });

    // Com o JEV reprovando continuamente, deve esgotar os 3 ciclos e bloquear na 4ª volta
    expect(cycleResult.ok).toBe(false);
    expect(cycleResult.finalPhaseContext.phase).toBe("BLOQUEADA");
    expect(cycleResult.finalPhaseContext.voltasConferencia).toBe(4);
    expect(repairCalls).toBe(3);
    expect(cycleResult.problems.some((p) => p.includes("Risco de segurança/isolamento"))).toBe(true);
  });
});
