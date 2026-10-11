import { describe, it, expect } from "vitest";
import { formatIntakeFunnelBrief, type IntakeFunnelResult } from "@/core/intake/universal-funnel";

describe("universal-funnel — Peneira de Afunilamento Universal do Intake (M0)", () => {
  it("formata a ficha de diretrizes de gateway financeiro whitelabel com todas as particularidades", () => {
    const funnel: IntakeFunnelResult = {
      appKind: "dashboard_admin",
      userModel: "multi_tenant_saas",
      complexityScore: 3,
      hasDatabase: true,
      hasAuth: true,
      hasFinancialPayments: true,
      hasExternalComms: true,
      hasPublicApi: true,
      hasWhitelabel: true,
      financialSplitModel: "subaccounts_split",
      notificationChannels: "whatsapp_and_email",
      hasStrictBusinessRules: true,
      source: "jev",
    };

    const brief = formatIntakeFunnelBrief(funnel);

    expect(brief).toContain("DASHBOARD ADMIN");
    expect(funnel.hasFinancialPayments).toBe(true);
    expect(brief).toContain("REGRA CRÍTICA DE REPASSE");
    expect(brief).toContain("asaasSubcontaId");
    expect(brief).toContain("Customização Whitelabel: MANDATÓRIA");
    expect(brief).toContain("WHATSAPP AND EMAIL");
    expect(brief).toContain("API Pública para Terceiros: MANDATÓRIA");
  });

  it("formata corretamente para um projeto simples sem financeiro ou whitelabel", () => {
    const simpleFunnel: IntakeFunnelResult = {
      appKind: "cli_automation",
      userModel: "internal_admin",
      complexityScore: 1,
      hasDatabase: false,
      hasAuth: false,
      hasFinancialPayments: false,
      hasExternalComms: false,
      hasPublicApi: false,
      hasWhitelabel: false,
      financialSplitModel: "not_applicable",
      notificationChannels: "none",
      hasStrictBusinessRules: false,
      source: "jev",
    };

    const brief = formatIntakeFunnelBrief(simpleFunnel);

    expect(brief).toContain("CLI AUTOMATION");
    expect(brief).not.toContain("REGRA CRÍTICA DE REPASSE");
    expect(brief).not.toContain("Customização Whitelabel");
    expect(brief).toContain("Não requerido");
  });
});
