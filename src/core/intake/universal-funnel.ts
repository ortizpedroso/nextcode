import { askJevBatch, type JevQuestionSpec } from "@/core/decision/jev";

export interface IntakeFunnelResult {
  appKind: string;
  userModel: string;
  complexityScore: number;
  hasDatabase: boolean;
  hasAuth: boolean;
  hasFinancialPayments: boolean;
  hasExternalComms: boolean;
  hasPublicApi: boolean;
  hasWhitelabel: boolean;
  financialSplitModel: string;
  notificationChannels: string;
  hasStrictBusinessRules: boolean;
  source: "jev" | "fallback";
  aConfirmar: string[];
}

/**
 * Peneira de Afunilamento Universal do Intake (M0).
 * Avalia o pedido em 3 níveis hierárquicos num único lote HTTP ao Jev:
 * 1. Macro: Tipo de aplicação e modelo de usuários.
 * 2. Mid: Camadas de banco, auth, financeiro, mensageria e API pública.
 * 3. Deep: Particularidades como whitelabel, split/subcontas e canais.
 */
export async function runUniversalIntakeFunnel(params: {
  prompt: string;
  sessionId?: string | null;
}): Promise<IntakeFunnelResult> {
  const promptText = params.prompt.slice(0, 16000);

  const questions: Record<string, JevQuestionSpec> = {
    app_kind: {
      type: "choice",
      instructions:
        "Classify the general software architecture requested in `prompt`.",
      criteria: {
        web_fullstack: "Fullstack web application with UI, backend APIs and state.",
        dashboard_admin: "Administrative dashboard, financial metrics, reports or management system.",
        api_backend: "Headless backend service, API or microservice without UI.",
        cli_automation: "Command-line tool, script or automated background worker.",
        landing_page: "Marketing page or website with minimal interactive state.",
        outro: "Other general software, utility or library.",
      },
    },
    user_model: {
      type: "choice",
      instructions: "Identify the user and tenant model requested in `prompt`.",
      criteria: {
        multi_tenant_saas: "Multi-tenant SaaS with distinct merchants, organizations, or customers.",
        authenticated_users: "Standard app with sign-in and individual user accounts.",
        public_open: "Public tool without user accounts or login.",
        internal_admin: "Internal tool with single operator or admin role.",
      },
    },
    complexity_score: {
      type: "score",
      instructions:
        "Rate the overall architectural complexity of the requested software.",
      criteria: [
        "Simple utility or single-page CRUD.",
        "Moderate web app with auth and multiple entities.",
        "Advanced platform with multiple integrations, webhooks, or financial workflows.",
        "High-complexity enterprise platform with split payments, whitelabel, and public APIs.",
      ],
    },
    has_database: {
      type: "noul",
      instructions:
        "Does this project require persistent data storage in a database (SQL, Prisma, or NoSQL)?",
    },
    has_auth: {
      type: "noul",
      instructions:
        "Does this project require user authentication, sign-in, sessions, or account security?",
    },
    has_financial_payments: {
      type: "noul",
      instructions:
        "Does this project involve financial payments, payment gateways (e.g. Asaas, Stripe), billing, charges, or checkout?",
    },
    has_external_comms: {
      type: "noul",
      instructions:
        "Does this project send automated external communications like emails, WhatsApp messages, or SMS?",
    },
    has_public_api: {
      type: "noul",
      instructions:
        "Does this project provide a public API for third-party platforms or e-commerces to integrate via API keys?",
    },
    has_whitelabel: {
      type: "noul",
      instructions:
        "Does this project require whitelabel customization (custom branding, logos, colors, or merchant-specific checkout)?",
    },
    financial_split_model: {
      type: "choice",
      instructions: "Identify how payment funds are routed if payments exist.",
      criteria: {
        subaccounts_split: "Payments route directly to service providers or merchants via subaccounts, API keys, or split rules.",
        single_merchant: "All payments route directly to a single central company/owner account.",
        not_applicable: "Project does not handle payment splitting or financial transactions.",
      },
    },
    notification_channels: {
      type: "choice",
      instructions: "Identify the requested notification channels for receipts or updates.",
      criteria: {
        whatsapp_and_email: "Both WhatsApp and email notifications are requested.",
        whatsapp_only: "Only WhatsApp notifications are requested.",
        email_only: "Only email notifications are requested.",
        none: "No external notification channels mentioned.",
      },
    },
    has_strict_business_rules: {
      type: "noul",
      instructions:
        "Did the user state explicit, non-negotiable business rules or constraints that must be preserved literally?",
    },
  };

  const batch = await askJevBatch({
    purpose: "m0_peneira_afunilamento_universal",
    state: JSON.stringify({ prompt: promptText }),
    questions,
    sessionId: params.sessionId,
    timeoutMs: 10000,
  });

  if (batch) {
    const appKind = (batch.app_kind?.type === "choice" ? batch.app_kind.choice : "web_fullstack");
    const userModel = (batch.user_model?.type === "choice" ? batch.user_model.choice : "authenticated_users");
    const complexityScore = (batch.complexity_score?.type === "score" ? batch.complexity_score.score : 2);
    const hasDatabase = (batch.has_database?.type === "noul" ? batch.has_database.noul >= 0.6 : true);
    const hasAuth = (batch.has_auth?.type === "noul" ? batch.has_auth.noul >= 0.6 : false);
    const hasFinancialPayments = (batch.has_financial_payments?.type === "noul" ? batch.has_financial_payments.noul >= 0.6 : false);
    const hasExternalComms = (batch.has_external_comms?.type === "noul" ? batch.has_external_comms.noul >= 0.6 : false);
    const hasPublicApi = (batch.has_public_api?.type === "noul" ? batch.has_public_api.noul >= 0.6 : false);
    const hasWhitelabel = (batch.has_whitelabel?.type === "noul" ? batch.has_whitelabel.noul >= 0.6 : false);
    const financialSplitModel = (batch.financial_split_model?.type === "choice" ? batch.financial_split_model.choice : "not_applicable");
    const notificationChannels = (batch.notification_channels?.type === "choice" ? batch.notification_channels.choice : "none");
    const hasStrictBusinessRules = (batch.has_strict_business_rules?.type === "noul" ? batch.has_strict_business_rules.noul >= 0.6 : true);

    const aConfirmar: string[] = [];
    for (const [qId, qSpec] of Object.entries(questions)) {
      const ans = batch[qId];
      if (!ans) continue;
      if (qSpec.type === "noul" && ans.type === "noul") {
        if (ans.noul > 0.25 && ans.noul < 0.75) {
          aConfirmar.push(qId);
        }
      } else if (qSpec.type === "choice" && ans.type === "choice") {
        if (typeof ans.confidence === "number" && ans.confidence < 0.6) {
          aConfirmar.push(qId);
        }
      }
    }

    return {
      appKind,
      userModel,
      complexityScore,
      hasDatabase,
      hasAuth,
      hasFinancialPayments,
      hasExternalComms,
      hasPublicApi,
      hasWhitelabel,
      financialSplitModel,
      notificationChannels,
      hasStrictBusinessRules,
      source: "jev",
      aConfirmar,
    };
  }

  // Fallback determinístico caso o Jev esteja inacessível
  const lower = promptText.toLowerCase();
  const hasPayments = /pagamento|cobranca|cobrança|gateway|asaas|stripe|pix|checkout/i.test(lower);
  const hasWpp = /whatsapp|watzap|zap/i.test(lower);
  const hasMail = /email|e-mail/i.test(lower);
  const hasWl = /whitelabel|white-label|personaliz/i.test(lower);
  const hasApi = /api|integra[çc][aã]o via api/i.test(lower);

  const fallbackAConfirmar = [
    "has_database",
    "has_auth",
    "has_financial_payments",
    "has_external_comms",
    "has_public_api",
    "has_whitelabel",
    "has_strict_business_rules",
  ];

  return {
    appKind: "web_fullstack",
    userModel: hasWl ? "multi_tenant_saas" : "authenticated_users",
    complexityScore: hasPayments ? 3 : 2,
    hasDatabase: true,
    hasAuth: true,
    hasFinancialPayments: hasPayments,
    hasExternalComms: hasWpp || hasMail,
    hasPublicApi: hasApi,
    hasWhitelabel: hasWl,
    financialSplitModel: hasPayments && /prestador|conta do/i.test(lower) ? "subaccounts_split" : "single_merchant",
    notificationChannels: hasWpp && hasMail ? "whatsapp_and_email" : hasWpp ? "whatsapp_only" : hasMail ? "email_only" : "none",
    hasStrictBusinessRules: true,
    source: "fallback",
    aConfirmar: fallbackAConfirmar,
  };
}

/**
 * Compila os fatos identificados pelo Jev em uma Ficha de Diretrizes
 * obrigatória para o Elicitador não omitir requisitos cruciais.
 */
export function formatIntakeFunnelBrief(funnel: IntakeFunnelResult): string {
  const lines: string[] = [
    "📋 [DIRETRIZES TÉCNICAS E DE NEGÓCIO IDENTIFICADAS PELO JEV — INCLUSÃO OBRIGATÓRIA NA SPEC]:",
  ];

  if (funnel.source === "fallback") {
    lines.push("- Estimativa por palavras-chave (o Jev não respondeu).");
  }

  const aConf = new Set(funnel.aConfirmar ?? []);
  if (aConf.size > 0) {
    lines.push(
      "- ATENÇÃO: os itens abaixo marcados [A CONFIRMAR] não são requisito; viram pergunta objetiva na seção 7 (Dúvidas em aberto) da Spec."
    );
  }

  // 1. Arquitetura do Software (app_kind)
  if (aConf.has("app_kind")) {
    lines.push("- Arquitetura do Software: [A CONFIRMAR] (o Jev não tem certeza — perguntar ao usuário)");
  } else {
    lines.push(`- Arquitetura do Software: ${funnel.appKind.replace(/_/g, " ").toUpperCase()}`);
  }

  // 2. Modelo de Acesso (user_model)
  if (aConf.has("user_model")) {
    lines.push("- Modelo de Acesso: [A CONFIRMAR] (o Jev não tem certeza — perguntar ao usuário)");
  } else {
    lines.push(`- Modelo de Acesso: ${funnel.userModel.replace(/_/g, " ").toUpperCase()}`);
  }

  // 3. Banco de Dados (has_database)
  if (aConf.has("has_database")) {
    lines.push("- Banco de Dados: [A CONFIRMAR] (o Jev não tem certeza — perguntar ao usuário)");
  } else {
    lines.push(
      `- Banco de Dados: ${funnel.hasDatabase ? "OBRIGATÓRIO (modelar schema Prisma e entidades relacionais)" : "Não requerido"}`
    );
  }

  // 4. Autenticação (has_auth)
  if (aConf.has("has_auth")) {
    lines.push("- Autenticação: [A CONFIRMAR] (o Jev não tem certeza — perguntar ao usuário)");
  } else {
    lines.push(
      `- Autenticação: ${funnel.hasAuth ? "OBRIGATÓRIA (modelar rotas de login/sessão e proteção de dashboard)" : "Opcional/Pública"}`
    );
  }

  // 5. Módulo Financeiro/Cobrança (has_financial_payments)
  if (aConf.has("has_financial_payments")) {
    lines.push(
      "- Módulo Financeiro/Cobrança: [A CONFIRMAR] (o Jev não tem certeza — perguntar ao usuário)"
    );
  } else if (funnel.hasFinancialPayments) {
    lines.push(
      "- Módulo Financeiro/Cobrança: MANDATÓRIO (modelar integração Asaas/Gateway, rotas de cobrança, checkout e webhooks)"
    );
    if (funnel.financialSplitModel === "subaccounts_split") {
      lines.push(
        "  * REGRA CRÍTICA DE REPASSE: O dinheiro vai direto para a conta do prestador/lojista. A entidade de usuário DEVE possuir campos para subconta Asaas (`asaasSubcontaId`) e/ou chave de API (`asaasApiKey`)."
      );
    }
  }

  // 6. Customização Whitelabel (has_whitelabel)
  if (aConf.has("has_whitelabel")) {
    lines.push(
      "- Customização Whitelabel: [A CONFIRMAR] (o Jev não tem certeza — perguntar ao usuário)"
    );
  } else if (funnel.hasWhitelabel) {
    lines.push(
      "- Customização Whitelabel: MANDATÓRIA (modelar entidade WhitelabelConfig com logo, cores primária/secundária e marca por lojista para aplicação no checkout público)"
    );
  }

  // 7. Canais de Notificação de Comprovante (has_external_comms / notification_channels)
  if (aConf.has("has_external_comms") || aConf.has("notification_channels")) {
    lines.push(
      "- Canais de Notificação de Comprovante: [A CONFIRMAR] (o Jev não tem certeza — perguntar ao usuário)"
    );
  } else if (funnel.hasExternalComms) {
    lines.push(
      `- Canais de Notificação de Comprovante: MANDATÓRIO (${funnel.notificationChannels.replace(/_/g, " ").toUpperCase()}) (modelar serviço de envio de comprovantes por e-mail e/ou WhatsApp com tratamento de falhas)`
    );
  }

  // 8. API Pública para Terceiros (has_public_api)
  if (aConf.has("has_public_api")) {
    lines.push(
      "- API Pública para Terceiros: [A CONFIRMAR] (o Jev não tem certeza — perguntar ao usuário)"
    );
  } else if (funnel.hasPublicApi) {
    lines.push(
      "- API Pública para Terceiros: MANDATÓRIA (modelar endpoints v1 protegidos por API Key para lojas e plataformas externas criarem cobranças)"
    );
  }

  lines.push(
    "- INTEGRIDADE: Toda funcionalidade acima DEVE possuir módulos, entidades, rotas e requisitos REQ-001... correspondentes com critérios verificáveis."
  );

  return lines.join("\n");
}
