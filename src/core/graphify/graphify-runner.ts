/**
 * Execução headless do pipeline do graphify (https://pypi.org/project/graphifyy/) sobre a pasta
 * de um projeto NextCode, sem depender de despacho de subagentes (indisponível fora do Claude
 * Code). Implementa apenas o "caminho rápido" documentado na skill original para corpora
 * 100% código: extração estrutural via AST (determinística, sem LLM e sem chave de API),
 * construção do grafo, clusterização e geração de graph.json + GRAPH_REPORT.md. Rótulos de
 * comunidade ficam como placeholder ("Community N") — a rotulagem semântica em linguagem
 * natural exigiria uma chamada de LLM adicional, fora do escopo deste botão de 1-clique.
 */
import { TerminalExecutionEngine } from "../execution/terminal-execution-engine";

export interface GraphifyRunResult {
  success: boolean;
  nodes?: number;
  edges?: number;
  communities?: number;
  godNodes?: unknown[];
  outDir?: string;
  htmlExported?: boolean;
  error?: string;
}

const PYTHON_CANDIDATES = ["python", "python3"];

/** Detecta qual binário Python está disponível no PATH do servidor (Windows normalmente expõe "python"). */
export async function resolvePythonBinary(cwd: string): Promise<string | null> {
  for (const bin of PYTHON_CANDIDATES) {
    const res = await TerminalExecutionEngine.runCommand(`${bin} -c "import sys"`, cwd, 10000);
    if (res.success) return bin;
  }
  return null;
}

/** Instala o pacote graphifyy via pip apenas se ainda não estiver disponível (evita custo de rede em execuções repetidas). */
export async function ensureGraphifyInstalled(
  pythonBin: string,
  cwd: string
): Promise<{ installed: boolean; log: string }> {
  const check = await TerminalExecutionEngine.runCommand(`${pythonBin} -c "import graphify"`, cwd, 10000);
  if (check.success) {
    return { installed: true, log: "pacote graphifyy já disponível no interpretador" };
  }

  const install = await TerminalExecutionEngine.runCommand(`${pythonBin} -m pip install graphifyy -q`, cwd, 120000);
  return { installed: install.success, log: install.success ? install.stdout : install.stderr };
}

/**
 * Monta o script Python do pipeline AST-only, equivalente aos Steps 1-4 (caminho código-apenas)
 * da skill /graphify original, mas sem a etapa interativa de rotulagem de comunidades (Step 5)
 * e sem despacho de subagentes para extração semântica (Part B — pulada por ser corpus de código).
 */
export function buildGraphifyPipelineScript(projectPath: string): string {
  const inputPathLiteral = JSON.stringify(projectPath);

  return `
import json, sys
from pathlib import Path
from graphify.detect import detect
from graphify.extract import collect_files, extract
from graphify.build import build_from_json
from graphify.cluster import cluster, score_all
from graphify.analyze import god_nodes, surprising_connections, suggest_questions
from graphify.report import generate
from graphify.export import to_json

INPUT_PATH = ${inputPathLiteral}
OUT_DIR = Path(INPUT_PATH) / "graphify-out"
OUT_DIR.mkdir(parents=True, exist_ok=True)

detect_result = detect(Path(INPUT_PATH))

code_files = []
for f in detect_result.get("files", {}).get("code", []):
    p = Path(f)
    code_files.extend(collect_files(p) if p.is_dir() else [p])

if code_files:
    extraction_ast = extract(code_files, cache_root=Path(INPUT_PATH))
else:
    extraction_ast = {"nodes": [], "edges": [], "input_tokens": 0, "output_tokens": 0}

extraction = {
    "nodes": extraction_ast["nodes"],
    "edges": extraction_ast["edges"],
    "hyperedges": [],
    "input_tokens": extraction_ast.get("input_tokens", 0),
    "output_tokens": extraction_ast.get("output_tokens", 0),
}

G = build_from_json(extraction, root=INPUT_PATH, directed=False)

if G.number_of_nodes() == 0:
    print("GRAPHIFY_RESULT_JSON=" + json.dumps({"success": False, "error": "Nenhum no extraido (EMPTY_GRAPH) - verifique se o caminho contem arquivos de codigo suportados."}))
    sys.exit(1)

communities = cluster(G)
cohesion = score_all(G, communities)
tokens = {"input": extraction.get("input_tokens", 0), "output": extraction.get("output_tokens", 0)}
gods = god_nodes(G)
surprises = surprising_connections(G, communities)
labels = {cid: "Community " + str(cid) for cid in communities}
questions = suggest_questions(G, communities, labels)

wrote = to_json(G, communities, str(OUT_DIR / "graph.json"))
if not wrote:
    print("GRAPHIFY_RESULT_JSON=" + json.dumps({"success": False, "error": "SHRINK_GUARD_REFUSED: grafo novo tem menos nos que o graph.json existente; rode com um graphify-out limpo se a reducao for intencional."}))
    sys.exit(1)

report = generate(G, communities, cohesion, labels, gods, surprises, detect_result, tokens, INPUT_PATH, suggested_questions=questions)
(OUT_DIR / "GRAPH_REPORT.md").write_text(report, encoding="utf-8")

god_list = gods if isinstance(gods, list) else list(gods)

summary = {
    "success": True,
    "nodes": G.number_of_nodes(),
    "edges": G.number_of_edges(),
    "communities": len(communities),
    "godNodes": god_list[:5],
    "outDir": str(OUT_DIR),
}
print("GRAPHIFY_RESULT_JSON=" + json.dumps(summary, ensure_ascii=False))
`.trim();
}

/** Extrai e parseia a linha de resultado estruturado (contrato próprio, não documentado pelo graphify original) que o script acima imprime em stdout. */
export function parseGraphifyStdout(stdout: string): GraphifyRunResult {
  const marker = "GRAPHIFY_RESULT_JSON=";
  const line = stdout
    .split("\n")
    .map((l) => l.trim())
    .reverse()
    .find((l) => l.startsWith(marker));

  if (!line) {
    return { success: false, error: "A execução do script Python não retornou um resultado reconhecível." };
  }

  try {
    const parsed = JSON.parse(line.slice(marker.length));
    return parsed as GraphifyRunResult;
  } catch {
    return { success: false, error: "Falha ao interpretar o JSON de resultado do graphify." };
  }
}

export async function runGraphifyPipeline(projectPath: string): Promise<GraphifyRunResult> {
  const pythonBin = await resolvePythonBinary(projectPath);
  if (!pythonBin) {
    return {
      success: false,
      error: "Python não encontrado no ambiente do servidor (tentado 'python' e 'python3'). Instale o Python 3 para usar o graphify.",
    };
  }

  const installState = await ensureGraphifyInstalled(pythonBin, projectPath);
  if (!installState.installed) {
    return {
      success: false,
      error: `Falha ao instalar o pacote 'graphifyy' via pip: ${installState.log.slice(0, 500)}`,
    };
  }

  const scriptContent = buildGraphifyPipelineScript(projectPath);
  const scriptPath = TerminalExecutionEngine.writeFile(
    "graphify-out/.nextcode_run_graphify.py",
    scriptContent,
    projectPath
  );

  const runRes = await TerminalExecutionEngine.runCommand(`${pythonBin} "${scriptPath}"`, projectPath, 180000);
  const parsed = parseGraphifyStdout(runRes.stdout);

  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error || runRes.stderr.slice(0, 500) || "Execução do graphify falhou sem mensagem de erro clara.",
    };
  }

  // Melhor esforço: exporta a visualização HTML interativa. Uma falha aqui não invalida o
  // grafo/relatório já gravados em disco (graph.json e GRAPH_REPORT.md já existem).
  const htmlRes = await TerminalExecutionEngine.runCommand(`graphify export html`, projectPath, 60000).catch(
    () => null
  );

  return { ...parsed, htmlExported: Boolean(htmlRes?.success) };
}
