import { describe, expect, it } from "vitest";
import { parseSpecDocument } from "@/core/intake/spec-format";
import {
  classifyMessageDeterministic,
  isSpecPresentationRequest,
} from "@/core/orchestrator/message-intent";
import {
  applyCumulativeSpecGuard,
  replyWhenSpecDraftRejected,
  specPresentationReply,
} from "@/core/orchestrator/spec-draft";

const storedSpec = `---
titulo: "API de Tarefas"
status: aguardando_aprovacao
stack:
  - "Next.js"
modulos:
  - id: api
    nome: "Rotas"
    resumo: "Criar e listar."
    arquivos:
      - "src/app/api/tasks/route.ts"
rotas:
  - caminho: "/api/tasks"
    descricao: "POST cria, GET lista."
arquivos_afetados:
  - "src/app/api/tasks/route.ts"
requisitos:
  - id: REQ-001
    titulo: "Listar e criar"
    criterio: "src/app/api/tasks/route.ts implementa GET e POST."
---

# API de Tarefas

Cobrança fica fora desta Spec.
`;

const deliveredEssay = `\`\`\`yaml
title: "NextPay — Especificação de Arquitetura"
status: "revisao"
rotas:
  - { caminho: "/api/health", cad: "Healthcheck do sistema" }
arquivos_afetados:
  - "src/lib/auth.ts"
\`\`\`

## NextPay — Visão Geral

Qual ponto você gostaria de aprofundar ou ajustar?
`;

describe("Pedido de apresentar a Spec é leitura, não reescrita", () => {
  it.each([
    "apresente a spec para revisão",
    "me apresente a spec",
    "mostre a especificação",
    "quero ver a spec",
  ])("é leitura: %s", (text) => {
    expect(isSpecPresentationRequest(text)).toBe(true);
    expect(classifyMessageDeterministic(text, "SPEC_REVISAO")).toBeNull();
  });

  it.each([
    "adicione pix na spec",
    "aprove a spec",
    "gere a spec",
    "reescreva a spec",
    "status",
    "corrija o bug da cobrança",
  ])("não é leitura: %s", (text) => {
    expect(isSpecPresentationRequest(text)).toBe(false);
  });

  it("devolve a Spec gravada e não chama o texto do modelo", () => {
    const reply = specPresentationReply(storedSpec);
    expect(reply).toBe(storedSpec.trim());
    expect(reply).not.toContain("Visão Geral");
  });

  it("sem Spec gravada recusa em vez de inventar", () => {
    expect(specPresentationReply(null)).toContain("Não há Spec gravada");
  });
});

describe("Rascunho com chaves fora do formato não vira a Spec da revisão", () => {
  it("o ensaio entregue não parseia", () => {
    expect(parseSpecDocument(deliveredEssay)).toBeNull();
  });

  it("a guarda mantém a Spec gravada e esconde o ensaio", () => {
    const res = applyCumulativeSpecGuard(storedSpec, deliveredEssay, "apresente a spec para revisão");
    expect(res.isValidSpec).toBe(false);
    expect(res.finalSpec).toBeNull();
    expect(res.finalMessageContent).toContain('titulo: "API de Tarefas"');
    expect(res.finalMessageContent).toContain("Nada foi alterado");
    expect(res.finalMessageContent).not.toContain("Visão Geral");
    expect(res.finalMessageContent).not.toContain("cad:");
    expect(res.finalMessageContent).not.toContain('title:');
  });

  it("sem Spec anterior a recusa não cola o ensaio", () => {
    const reply = replyWhenSpecDraftRejected(null);
    expect(reply).toContain("campo titulo");
    expect(reply).not.toContain("Visão Geral");
    expect(reply).not.toContain("NextPay");
  });
});
