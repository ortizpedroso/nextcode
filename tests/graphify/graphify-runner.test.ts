import { describe, it, expect } from "vitest";
import { buildGraphifyPipelineScript, parseGraphifyStdout } from "../../src/core/graphify/graphify-runner";

describe("buildGraphifyPipelineScript", () => {
  it("embute o caminho do projeto como literal Python válido (round-trip via JSON.parse)", () => {
    const projectPath = "C:\\projetos\\meu-projeto";
    const script = buildGraphifyPipelineScript(projectPath);

    const match = script.match(/INPUT_PATH = (.+)/);
    expect(match).toBeTruthy();
    expect(JSON.parse(match![1])).toBe(projectPath);
  });

  it("usa apenas o caminho rápido AST-only documentado (sem extração semântica via LLM)", () => {
    const script = buildGraphifyPipelineScript("/tmp/projeto");

    expect(script).toContain("from graphify.detect import detect");
    expect(script).toContain("from graphify.extract import collect_files, extract");
    expect(script).toContain("from graphify.build import build_from_json");
    expect(script).toContain("from graphify.cluster import cluster, score_all");
    expect(script).toContain("from graphify.analyze import god_nodes, surprising_connections, suggest_questions");
    expect(script).toContain("from graphify.report import generate");
    expect(script).toContain("from graphify.export import to_json");
    expect(script).not.toContain("openai");
    expect(script).not.toContain("anthropic");
  });

  it("imprime um marcador de resultado estruturado em qualquer caminho de saída (sucesso ou erro)", () => {
    const script = buildGraphifyPipelineScript("/tmp/projeto");
    const markerCount = script.split("GRAPHIFY_RESULT_JSON=").length - 1;
    expect(markerCount).toBe(3); // grafo vazio, shrink-guard recusado, sucesso
  });
});

describe("parseGraphifyStdout", () => {
  it("extrai e parseia a última linha de resultado JSON em stdout com ruído antes e depois", () => {
    const resultPayload = { success: true, nodes: 10, edges: 5, communities: 2, outDir: "/x/graphify-out" };
    const stdout = ["algum log de progresso", `GRAPHIFY_RESULT_JSON=${JSON.stringify(resultPayload)}`, ""].join("\n");

    const result = parseGraphifyStdout(stdout);

    expect(result.success).toBe(true);
    expect(result.nodes).toBe(10);
    expect(result.edges).toBe(5);
    expect(result.communities).toBe(2);
  });

  it("retorna success=false com mensagem clara quando não há linha de resultado", () => {
    const result = parseGraphifyStdout("Traceback (most recent call last):\n  algum erro python sem marcador");

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("retorna success=false quando o JSON está corrompido", () => {
    const result = parseGraphifyStdout("GRAPHIFY_RESULT_JSON={isso não é json válido");

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("pega a ÚLTIMA linha de marcador quando o script imprime mais de uma (ex.: erro seguido de sucesso não deveria ocorrer, mas o parser deve ser determinístico)", () => {
    const stdout = [
      `GRAPHIFY_RESULT_JSON=${JSON.stringify({ success: false, error: "primeira" })}`,
      `GRAPHIFY_RESULT_JSON=${JSON.stringify({ success: true, nodes: 1, edges: 0, communities: 1 })}`,
    ].join("\n");

    const result = parseGraphifyStdout(stdout);

    expect(result.success).toBe(true);
    expect(result.nodes).toBe(1);
  });
});
