/**
 * Módulo de Memória Persistente de Projeto (Project Memory)
 *
 * Implementa a camada L2 (Memória Episódica/Decisória de Longo Prazo) do NextCode.
 * Armazena decisões arquiteturais consolidadas, regras do fundador e lições aprendidas
 * no arquivo `.nextcode/MEMORY.md` na raiz do projeto.
 *
 * Princípios de Engenharia:
 *  - Teto rígido de 50 linhas (~300 tokens): não polui o contexto nem gera estouro.
 *  - Factual e limpo: nunca armazena código bruto ou logs de terminal.
 *  - Git-friendly: arquivo Markdown limpo versionável junto com o repositório.
 */

import * as fs from "fs";
import * as path from "path";
import { TelemetryLogger } from "@/core/telemetry/telemetry-logger";
import type { ParsedSpec } from "@/core/intake/spec-format";

export const MEMORY_DIR_NAME = ".nextcode";
export const MEMORY_FILE_NAME = "MEMORY.md";
export const MAX_MEMORY_LINES = 50;
export const MAX_MEMORY_BYTES = 6000;

export interface ProjectMemorySections {
  diretrizes: string[];
  arquitetura: string[];
  licoes: string[];
}

/**
 * Lê o arquivo `.nextcode/MEMORY.md` de um projeto de forma segura.
 */
export function readProjectMemory(projectPath: string): string | null {
  if (!projectPath || !fs.existsSync(projectPath)) return null;

  const memoryFilePath = path.join(projectPath, MEMORY_DIR_NAME, MEMORY_FILE_NAME);
  try {
    if (!fs.existsSync(memoryFilePath)) return null;
    const stat = fs.lstatSync(memoryFilePath);
    if (!stat.isFile()) return null;

    const content = fs.readFileSync(memoryFilePath, "utf8");
    return content.trim() ? content : null;
  } catch {
    return null;
  }
}

/**
 * Grava ou atualiza `.nextcode/MEMORY.md` garantindo tetos de linhas e bytes.
 */
export function writeProjectMemory(projectPath: string, content: string): boolean {
  if (!projectPath || !fs.existsSync(projectPath)) return false;

  const dirPath = path.join(projectPath, MEMORY_DIR_NAME);
  const memoryFilePath = path.join(dirPath, MEMORY_FILE_NAME);

  try {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }

    // Teto estrito de linhas (máx 50 linhas)
    const rawLines = content.trim().split(/\r?\n/);
    // S3 (mudança 44): corte nunca calado — a última linha diz quantas ficaram de fora.
    const cortadas = Math.max(0, rawLines.length - MAX_MEMORY_LINES);
    const lines = cortadas > 0 ? [...rawLines.slice(0, MAX_MEMORY_LINES - 1), `<!-- ${cortadas + 1} linha(s) cortada(s) pelo teto de ${MAX_MEMORY_LINES} -->`] : rawLines;
    let sanitized = lines.join("\n");
    if (Buffer.byteLength(sanitized, "utf8") > MAX_MEMORY_BYTES) {
      sanitized = sanitized.slice(0, MAX_MEMORY_BYTES - 60).trimEnd() + "\n<!-- cortado pelo teto de bytes -->";
    }
    sanitized = sanitized.trimEnd() + "\n";

    fs.writeFileSync(memoryFilePath, sanitized, "utf8");
    return true;
  } catch {
    return false;
  }
}

/**
 * Converte seções estruturadas no formato Markdown canônico de memória.
 */
export function renderProjectMemoryDocument(params: {
  projectName: string;
  sections: ProjectMemorySections;
}): string {
  // S3 (mudança 44): o teto de linhas é dividido entre as 3 seções; antes as do fim ("Armadilhas") sumiam
  // caladas quando as primeiras eram longas (teste real: 66 linhas geradas, 41 gravadas).
  const porSecao = Math.floor((MAX_MEMORY_LINES - 8) / 3) - 1;
  const limitar = (itens: string[]) =>
    itens.length > porSecao ? [...itens.slice(0, porSecao), `(+${itens.length - porSecao} omitido(s) — ver a Spec)`] : itens;
  const sections = {
    diretrizes: limitar(params.sections.diretrizes),
    arquitetura: limitar(params.sections.arquitetura),
    licoes: limitar(params.sections.licoes),
  };
  const lines: string[] = [
    `# Memória do Projeto: ${params.projectName}`,
    `<!-- Atualizado automaticamente pelo NextCode. Máx: ${MAX_MEMORY_LINES} linhas -->`,
    "",
    "## 1. Diretrizes e Regras do Fundador",
  ];

  if (sections.diretrizes.length > 0) {
    for (const d of sections.diretrizes) lines.push(`- ${d}`);
  } else {
    lines.push("- (Nenhuma restrição adicional registrada)");
  }

  lines.push("", "## 2. Decisões de Arquitetura e Contratos");
  if (sections.arquitetura.length > 0) {
    for (const a of sections.arquitetura) lines.push(`- ${a}`);
  } else {
    lines.push("- (Arquitetura inicial em definição)");
  }

  lines.push("", "## 3. Armadilhas e Lições Aprendidas");
  if (sections.licoes.length > 0) {
    for (const l of sections.licoes) lines.push(`- ${l}`);
  } else {
    lines.push("- (Nenhum bug recorrente ou armadilha reportada)");
  }

  return lines.join("\n");
}

/**
 * Extrai tópicos factuais de uma Spec Canônica aprovada e consolida na memória do projeto.
 */
export function consolidateMemoryFromSpec(params: {
  projectPath: string;
  projectName: string;
  spec: ParsedSpec;
  sessionId?: string | null;
}): { success: boolean; memoryText: string } {
  const current = readProjectMemory(params.projectPath);
  const sections: ProjectMemorySections = {
    diretrizes: [
      "App Router do Next.js com TypeScript e tipagem estrita.",
      "Todo page.tsx/layout.tsx deve exportar função padrão (export default).",
      "Comentários em arquivos CSS devem usar /* ... */ (nunca //).",
    ],
    arquitetura: [],
    licoes: [],
  };

  // Extrai módulos e arquivos da Spec
  for (const mod of params.spec.modulos) {
    const arquivosStr = (mod.arquivos || []).join(", ");
    sections.arquitetura.push(
      `Módulo '${mod.nome || mod.id}': ${mod.resumo || ""}${arquivosStr ? ` [${arquivosStr}]` : ""}`
    );
  }

  // Extrai rotas HTTP
  for (const r of params.spec.rotas) {
    sections.arquitetura.push(`Rota '${r.caminho}': ${r.descricao}`);
  }

  // Extrai requisitos formais de alto nível (título + ID)
  if (params.spec.requisitos && params.spec.requisitos.length > 0) {
    for (const req of params.spec.requisitos.slice(0, 8)) {
      sections.arquitetura.push(`Requisito ${req.id}: ${req.titulo}`);
    }
  }

  const memoryText = renderProjectMemoryDocument({
    projectName: params.projectName,
    sections,
  }).trim() + "\n";

  const wrote = writeProjectMemory(params.projectPath, memoryText);

  if (wrote) {
    TelemetryLogger.log({
      sessionId: params.sessionId ?? undefined,
      action: "PROJECT_MEMORY_UPDATED",
      details: {
        projectPath: params.projectPath,
        linesCount: memoryText.split("\n").length,
        modulesCount: params.spec.modulos.length,
      },
    });
  }

  return { success: wrote, memoryText };
}
