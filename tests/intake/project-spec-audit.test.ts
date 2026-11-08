import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  runProjectSpecAudit,
  buildProjectRepositorySurvey,
  surveyToNewCanonicalSpec,
  reconcileParsedSpecWithSurvey,
  renderSurveyGapsMarkdown,
  renderReconcileMarkdown,
  publishProjectSpecAuditArtifacts,
} from "@/core/intake/project-repository-survey";
import {
  CANONICAL_SPEC_RELATIVE_PATH,
  SPEC_GAPS_RELATIVE_PATH,
  SPEC_RECONCILE_RELATIVE_PATH,
  readCanonicalSpecFile,
  writeCanonicalSpecFile,
} from "@/core/intake/spec-file";
import { parseSpecDocument } from "@/core/intake/spec-format";
import { checkSpecStructure } from "@/core/intake/spec-check";
import { loadRoleSkill } from "@/core/skills/skill-runtime";
import { isProjectSpecAuditRequest } from "@/core/orchestrator/message-intent";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignora limpeza de arquivo temporário
    }
  }
});

function tempProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nc-spec-audit-"));
  dirs.push(dir);
  return dir;
}

function writeJson(filePath: string, data: any) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function writeText(filePath: string, content: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

describe("Levantador de Repositório (Audit e Reconciliação)", () => {
  it("Cenário 1: Mini monorepo fake Next-like -> criar, parse OK, gaps presente", () => {
    const root = tempProject();

    // Cria package.json
    writeJson(path.join(root, "package.json"), {
      name: "mini-next-app",
      version: "1.0.0",
      dependencies: {
        next: "14.2.0",
        react: "18.3.0",
        prisma: "5.14.0",
      },
      devDependencies: {
        typescript: "5.4.0",
      },
    });

    // Cria rotas App Router e arquivos fonte
    writeText(
      path.join(root, "src/app/api/tasks/route.ts"),
      "export async function GET() { return Response.json([]); }\nexport async function POST() { return Response.json({}); }"
    );
    writeText(
      path.join(root, "src/app/api/users/[id]/route.ts"),
      "export async function GET() { return Response.json({}); }"
    );
    writeText(
      path.join(root, "src/lib/db.ts"),
      "export const db = {};"
    );

    // Cria schema prisma
    writeText(
      path.join(root, "prisma/schema.prisma"),
      `datasource db {
  provider = "sqlite"
  url      = "file:./dev.db"
}

model Task {
  id        String   @id
  title     String
  done      Boolean
}
`
    );

    const result = runProjectSpecAudit(root);

    // 1. Modo criar
    expect(result.mode).toBe("criar");
    expect(result.gravouSpec).toBe(true);
    expect(result.gravouGaps).toBe(true);

    // 2. Parse OK da Spec gerada
    expect(result.specText).not.toBeNull();
    const parsed = parseSpecDocument(result.specText!);
    expect(parsed).not.toBeNull();
    expect(parsed?.titulo).toBe("mini-next-app");
    expect(parsed?.status).toBe("aguardando_aprovacao");
    expect(parsed?.stack).toContain("next");
    expect(parsed?.stack).toContain("react");
    expect(parsed?.arquivosAfetados).toContain("src/app/api/tasks/route.ts");
    expect(parsed?.arquivosAfetados).toContain("src/app/api/users/[id]/route.ts");
    expect(parsed?.arquivosAfetados).toContain("src/lib/db.ts");

    // 3. checkSpecStructure sem erros
    const checkErrors = checkSpecStructure(parsed!);
    expect(checkErrors).toEqual([]);
    expect(result.checkErrors).toEqual([]);

    // 4. Artefatos gravados no disco
    expect(fs.existsSync(path.join(root, CANONICAL_SPEC_RELATIVE_PATH))).toBe(true);
    expect(fs.existsSync(path.join(root, SPEC_GAPS_RELATIVE_PATH))).toBe(true);

    // 5. Gaps presente no resultado e no markdown
    expect(result.gapsMarkdown).toContain("# Relatório de Lacunas do Repositório: mini-next-app");
    expect(result.survey.rotasApi.length).toBe(2);
    expect(result.survey.entidades.length).toBe(1);
    expect(result.survey.entidades[0].nome).toBe("Task");
  });

  it("Cenário 2: Spec fixture + arquivo novo -> reconciliar, arquivosAdicionados, status aguardando_aprovacao", () => {
    const root = tempProject();

    // Setup base
    writeJson(path.join(root, "package.json"), { name: "service-app" });
    writeText(path.join(root, "src/lib/existing.ts"), "export const a = 1;");

    const initialSpec = `---
titulo: "service-app"
status: aguardando_aprovacao
data: "2026-11-01"
stack:
  - "typescript"
modulos:
  - id: mod-src-lib
    nome: "Módulo src/lib"
    resumo: "Arquivos de lib"
    arquivos:
      - "src/lib/existing.ts"
arquivos_afetados:
  - "src/lib/existing.ts"
requisitos:
  - id: REQ-001
    titulo: "Existing"
    criterio: "src/lib/existing.ts implementa utilitários."
    origem: "requisito original"
---

# service-app

Documento inicial.
`;
    writeCanonicalSpecFile(root, initialSpec);

    // Adiciona novo arquivo no repositório
    writeText(path.join(root, "src/lib/new-feature.ts"), "export const b = 2;");

    const result = runProjectSpecAudit(root);

    expect(result.mode).toBe("reconciliar");
    expect(result.gravouSpec).toBe(true);
    expect(result.delta).not.toBeNull();
    expect(result.delta?.arquivosAdicionados).toContain("src/lib/new-feature.ts");
    expect(result.delta?.requisitosPreservados).toContain("REQ-001");
    expect(result.delta?.requisitosNovos.length).toBeGreaterThan(0);

    const onDisk = readCanonicalSpecFile(root);
    expect(onDisk).not.toBeNull();
    const parsed = parseSpecDocument(onDisk!);
    expect(parsed?.status).toBe("aguardando_aprovacao");
    expect(parsed?.arquivosAfetados).toContain("src/lib/new-feature.ts");
    expect(parsed?.arquivosAfetados).toContain("src/lib/existing.ts");
    expect(checkSpecStructure(parsed!)).toEqual([]);

    expect(fs.existsSync(path.join(root, SPEC_RECONCILE_RELATIVE_PATH))).toBe(true);
  });

  it("Cenário 3: REQ aponta arquivo removido -> REQ preservado, aviso/lacuna", () => {
    const root = tempProject();

    writeJson(path.join(root, "package.json"), { name: "cleanup-app" });
    writeText(path.join(root, "src/lib/active.ts"), "export const active = true;");
    // "src/lib/deleted.ts" NÃO existe no disco

    const existingSpec = `---
titulo: "cleanup-app"
status: aguardando_aprovacao
data: "2026-11-01"
stack:
  - "typescript"
modulos:
  - id: mod-lib
    nome: "Lib"
    resumo: "Módulo lib"
    arquivos:
      - "src/lib/active.ts"
      - "src/lib/deleted.ts"
arquivos_afetados:
  - "src/lib/active.ts"
  - "src/lib/deleted.ts"
requisitos:
  - id: REQ-001
    titulo: "Ativo"
    criterio: "src/lib/active.ts funciona."
    origem: "origem-1"
  - id: REQ-002
    titulo: "Legado Removido"
    criterio: "src/lib/deleted.ts funcionalidade antiga."
    origem: "origem-2"
---

# cleanup-app

Documento.
`;
    writeCanonicalSpecFile(root, existingSpec);

    const result = runProjectSpecAudit(root);

    expect(result.mode).toBe("reconciliar");
    expect(result.delta?.arquivosRemovidosNaSpec).toContain("src/lib/deleted.ts");
    // REQ-002 deve ser preservado!
    expect(result.delta?.requisitosPreservados).toContain("REQ-002");
    expect(result.delta?.avisos.some((a) => a.includes("src/lib/deleted.ts"))).toBe(true);

    // Lacuna registrada
    expect(
      result.survey.lacunas.some((l) => l.codigo === "spec_arquivo_inexistente_no_disco")
    ).toBe(true);

    const onDisk = readCanonicalSpecFile(root);
    const parsed = parseSpecDocument(onDisk!);
    expect(parsed?.requisitos?.some((r) => r.id === "REQ-002")).toBe(true);
  });

  it("Cenário 4: Segunda execução sem mudanças -> sem_alteracao", () => {
    const root = tempProject();

    writeJson(path.join(root, "package.json"), { name: "idempotent-app" });
    writeText(path.join(root, "src/index.ts"), "console.log('hi');");

    // 1ª execução: cria spec
    const first = runProjectSpecAudit(root);
    expect(first.mode).toBe("criar");
    expect(first.gravouSpec).toBe(true);

    const onDisk1 = readCanonicalSpecFile(root);
    expect(onDisk1).not.toBeNull();

    // 2ª execução sem modificar arquivos
    const second = runProjectSpecAudit(root);
    expect(second.mode).toBe("sem_alteracao");
    expect(second.gravouSpec).toBe(false);

    // Assert de idempotência byte-a-byte
    const onDisk2 = readCanonicalSpecFile(root);
    expect(onDisk2).toBe(onDisk1);
    expect(second.specText?.replace(/\r\n/g, "\n").trim()).toBe(
      onDisk1?.replace(/\r\n/g, "\n").trim()
    );
  });

  it("Cenário 5: Spec status: aprovada sem force -> bloqueado (e com force: true reabre)", () => {
    const root = tempProject();

    writeJson(path.join(root, "package.json"), { name: "approved-app" });
    writeText(path.join(root, "src/core.ts"), "export const c = 1;");

    const approvedSpec = `---
titulo: "approved-app"
status: aprovada
data: "2026-11-01"
stack: []
modulos:
  - id: mod-core
    nome: "Core"
    resumo: "Módulo core"
    arquivos:
      - "src/core.ts"
arquivos_afetados:
  - "src/core.ts"
requisitos:
  - id: REQ-001
    titulo: "Core"
    criterio: "src/core.ts implementado."
    origem: "aprovado"
---

# approved-app

Documento aprovado.
`;
    writeCanonicalSpecFile(root, approvedSpec);

    // Adiciona novo arquivo no repositório
    writeText(path.join(root, "src/new.ts"), "export const n = 2;");

    // Sem force -> bloqueado
    const blockedResult = runProjectSpecAudit(root, { force: false });
    expect(blockedResult.mode).toBe("bloqueado");
    expect(blockedResult.gravouSpec).toBe(false);
    expect(blockedResult.motivoBloqueio).toContain("status: aprovada");

    // A spec no disco não foi alterada
    const currentOnDisk = readCanonicalSpecFile(root);
    expect(parseSpecDocument(currentOnDisk!)?.status).toBe("aprovada");

    // Com force: true -> reconcilia
    const forcedResult = runProjectSpecAudit(root, { force: true });
    expect(forcedResult.mode).toBe("reconciliar");
    expect(forcedResult.gravouSpec).toBe(true);

    const reloaded = readCanonicalSpecFile(root);
    expect(parseSpecDocument(reloaded!)?.status).toBe("aguardando_aprovacao");
  });

  it("Cenário 6: Macrobrief fixture + arquivo extra -> lacuna de cobertura", () => {
    const root = tempProject();

    writeJson(path.join(root, "package.json"), { name: "macro-app" });
    writeText(path.join(root, "src/core/main.ts"), "export const m = 1;");
    writeText(path.join(root, "src/extra/bonus.ts"), "export const b = 2;");

    // Cria .nextcode/macrobrief.md cobrindo apenas src/core/main.ts
    const macrobriefContent = `---
documento: macrobrief
spec_versao: 1
clusters_ativos:
  - core
clusters:
  - id: core
    arquivos:
      - src/core/main.ts
    reqs:
      - REQ-001
    depende_de: []
---

# Macrobrief
`;
    writeText(path.join(root, ".nextcode/macrobrief.md"), macrobriefContent);

    const survey = buildProjectRepositorySurvey(root);
    expect(survey.macrobrief.presente).toBe(true);
    expect(survey.macrobrief.specVersao).toBe(1);

    // O arquivo src/extra/bonus.ts não está no cluster core
    const gap = survey.lacunas.find((l) => l.detalhe.includes("src/extra/bonus.ts"));
    expect(gap).toBeDefined();
    expect(["arquivo_sem_modulo", "arquivo_sem_req"]).toContain(gap?.codigo);
  });

  it("Habilidade catalogada é listável por loadRoleSkill('levantador-repositorio')", () => {
    const skill = loadRoleSkill("levantador-repositorio");
    expect(skill.name).toBe("levantador-repositorio");
    expect(skill.papel).toBe("conferente");
    expect(skill.ferramentas).toEqual([]);
    expect(skill.permissoes.escrever).toBe("nunca");
    expect(skill.passosMax).toBe(1);
    expect(skill.bodyMarkdown).toContain("Papel: Levantador de repositório");
  });

  it("Detector de intenção determinística reconhece comandos e frases em pt-BR", () => {
    expect(isProjectSpecAuditRequest("/levantador-repositorio")).toBe(true);
    expect(isProjectSpecAuditRequest("levantar repositório")).toBe(true);
    expect(isProjectSpecAuditRequest("levantar repositorio")).toBe(true);
    expect(isProjectSpecAuditRequest("auditar repositório")).toBe(true);
    expect(isProjectSpecAuditRequest("auditoria do código")).toBe(true);
    expect(isProjectSpecAuditRequest("atualizar spec com o código")).toBe(true);
    expect(isProjectSpecAuditRequest("reconciliar spec")).toBe(true);
    expect(isProjectSpecAuditRequest("inventário do projeto")).toBe(true);
    expect(isProjectSpecAuditRequest("inventario do projeto")).toBe(true);

    expect(isProjectSpecAuditRequest("olá, como vai você?")).toBe(false);
    expect(isProjectSpecAuditRequest("status")).toBe(false);
  });
});
