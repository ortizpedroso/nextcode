import * as fs from "fs";
import * as path from "path";
import { SOURCE_EXTENSIONS, IGNORED_DIRS } from "@/core/project/source-files";
import { parseElicitadorMacrobrief } from "@/core/intake/macrobrief-elicitador";
import type {
  ProjectRepositorySurvey,
  SurveyProvenance,
} from "./project-repository-survey";

export function extractProjectTitle(projectRoot: string): string {
  const pkgPath = path.join(projectRoot, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const content = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      if (typeof content.name === "string" && content.name.trim()) {
        return content.name.trim();
      }
    } catch {
      // continua para fallback
    }
  }
  const base = path.basename(path.resolve(projectRoot));
  return base || "projeto";
}

export function extractProjectStack(projectRoot: string): string[] {
  const stack = new Set<string>();
  const pkgPath = path.join(projectRoot, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const content = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      const deps = Object.keys(content.dependencies || {});
      const devDeps = Object.keys(content.devDependencies || {});
      for (const d of [...deps, ...devDeps]) {
        if (d) stack.add(d);
      }
    } catch {
      // ignora
    }
  }

  // Sinais opcionais em pyproject.toml ou go.mod
  const pyproject = path.join(projectRoot, "pyproject.toml");
  if (fs.existsSync(pyproject)) stack.add("python");
  const gomod = path.join(projectRoot, "go.mod");
  if (fs.existsSync(gomod)) stack.add("go");

  return Array.from(stack).sort();
}

export function extractSourceFiles(projectRoot: string): string[] {
  const files: string[] = [];
  if (!projectRoot || !fs.existsSync(projectRoot)) return files;

  const walk = (currentDir: string) => {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const name = entry.name;
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(name) || name.startsWith(".")) continue;
        walk(path.join(currentDir, name));
      } else if (entry.isFile()) {
        const ext = path.extname(name).toLowerCase();
        if (SOURCE_EXTENSIONS.has(ext)) {
          const rel = path
            .relative(projectRoot, path.join(currentDir, name))
            .replace(/\\/g, "/");
          files.push(rel);
        }
      }
    }
  };

  walk(path.resolve(projectRoot));
  return files.sort();
}

/**
 * Heurística de rotas API:
 * Varre arquivos sob src/app/api/... ou app/api/... (App Router) e src/pages/api/... ou pages/api/... (Pages Router).
 * Trata segmentos dinâmicos preservando sintaxe compatível com routeFileCandidates (ex.: [id]).
 */
export function extractApiRoutes(
  projectRoot: string,
  sourceFiles: string[]
): Array<{ caminho: string; arquivo: string }> {
  const routes: Array<{ caminho: string; arquivo: string }> = [];

  for (const file of sourceFiles) {
    // App Router: (src/)?app/api/(.+)/route\.(ts|tsx|js|jsx)
    const appMatch = file.match(/^(?:src\/)?app\/api\/(.+)\/route\.(?:ts|tsx|js|jsx)$/);
    if (appMatch) {
      const subpath = appMatch[1].replace(/\/+$/, "");
      routes.push({
        caminho: `/api/${subpath}`,
        arquivo: file,
      });
      continue;
    }

    // Pages Router: (src/)?pages/api/(.+)\.(?:ts|tsx|js|jsx)
    const pagesMatch = file.match(/^(?:src\/)?pages\/api\/(.+)\.(?:ts|tsx|js|jsx)$/);
    if (pagesMatch) {
      let subpath = pagesMatch[1].replace(/\/index$/, "");
      if (!subpath) subpath = "";
      routes.push({
        caminho: subpath ? `/api/${subpath}` : "/api",
        arquivo: file,
      });
    }
  }

  return routes;
}

export function extractPrismaEntities(
  projectRoot: string
): Array<{ nome: string; campos: Array<{ nome: string; tipo: string }> }> {
  const entities: Array<{ nome: string; campos: Array<{ nome: string; tipo: string }> }> = [];
  const candidates = [
    path.join(projectRoot, "prisma", "schema.prisma"),
    path.join(projectRoot, "schema.prisma"),
  ];

  let prismaPath: string | null = null;
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      prismaPath = p;
      break;
    }
  }

  if (!prismaPath) return entities;

  try {
    const content = fs.readFileSync(prismaPath, "utf8");
    const modelRegex = /model\s+([A-Za-z0-9_]+)\s*\{([^}]*)\}/g;
    let match: RegExpExecArray | null;

    while ((match = modelRegex.exec(content)) !== null) {
      const modelName = match[1];
      const body = match[2];
      const lines = body.split(/\r?\n/);
      const campos: Array<{ nome: string; tipo: string }> = [];

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("@@")) continue;
        const fieldMatch = trimmed.match(/^([A-Za-z0-9_]+)\s+([A-Za-z0-9_]+(?:\[\]|\?)?)/);
        if (fieldMatch) {
          campos.push({
            nome: fieldMatch[1],
            tipo: fieldMatch[2],
          });
        }
      }

      entities.push({
        nome: modelName,
        campos,
      });
    }
  } catch {
    // ignora falha de leitura do prisma
  }

  return entities;
}

export function extractMacrobriefInfo(projectRoot: string): {
  presente: boolean;
  specVersao: number | null;
  arquivosMacrobrief: string[];
  reqsMacrobrief: string[];
  clusters: Array<{ id: string; arquivos: string[]; reqs: string[] }>;
} {
  const mbPath = path.join(projectRoot, ".nextcode", "macrobrief.md");
  if (!fs.existsSync(mbPath)) {
    return {
      presente: false,
      specVersao: null,
      arquivosMacrobrief: [],
      reqsMacrobrief: [],
      clusters: [],
    };
  }

  try {
    const raw = fs.readFileSync(mbPath, "utf8");
    const parsed = parseElicitadorMacrobrief(raw);
    if (!parsed) {
      return {
        presente: false,
        specVersao: null,
        arquivosMacrobrief: [],
        reqsMacrobrief: [],
        clusters: [],
      };
    }

    const arquivosMacrobrief = parsed.clusters.flatMap((c) => c.arquivos);
    const reqsMacrobrief = parsed.clusters.flatMap((c) => c.reqs);

    return {
      presente: true,
      specVersao: parsed.specVersao,
      arquivosMacrobrief,
      reqsMacrobrief,
      clusters: parsed.clusters.map((c) => ({
        id: c.id,
        arquivos: c.arquivos,
        reqs: c.reqs,
      })),
    };
  } catch {
    return {
      presente: false,
      specVersao: null,
      arquivosMacrobrief: [],
      reqsMacrobrief: [],
      clusters: [],
    };
  }
}

/**
 * Agrupa arquivos por prefixo quando não há macrobrief.
 * Ex.: src/app/api/... -> mod-src-app-api
 *      src/lib/... -> mod-src-lib
 */
export function groupFilesByPrefix(files: string[]): Array<{
  id: string;
  nome: string;
  resumo: string;
  arquivos: string[];
  proveniencia: SurveyProvenance;
}> {
  const groups = new Map<string, string[]>();

  for (const file of files) {
    const parts = file.split("/");
    let prefix = "raiz";
    if (parts.length > 1) {
      if (parts[0] === "src" && parts.length > 2) {
        if (parts[1] === "app" && parts[2] === "api") {
          prefix = "src/app/api";
        } else {
          prefix = `src/${parts[1]}`;
        }
      } else {
        prefix = parts[0];
      }
    }

    const list = groups.get(prefix) ?? [];
    list.push(file);
    groups.set(prefix, list);
  }

  const modules: Array<{
    id: string;
    nome: string;
    resumo: string;
    arquivos: string[];
    proveniencia: SurveyProvenance;
  }> = [];

  for (const [prefix, groupFiles] of groups.entries()) {
    const slug = prefix.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
    modules.push({
      id: `mod-${slug}`,
      nome: `Módulo ${prefix}`,
      resumo: `Agrupamento mecânico dos arquivos sob ${prefix}.`,
      arquivos: groupFiles.sort(),
      proveniencia: "inferido",
    });
  }

  return modules.sort((a, b) => a.id.localeCompare(b.id));
}

export function buildSurveyFromExtracted(
  projectRoot: string,
  titulo: string,
  stack: string[],
  arquivosFonte: string[],
  rotasApi: Array<{ caminho: string; arquivo: string }>,
  entidades: Array<{ nome: string; campos: Array<{ nome: string; tipo: string }> }>,
  macrobriefData: ReturnType<typeof extractMacrobriefInfo>
): ProjectRepositorySurvey {
  const modulos: ProjectRepositorySurvey["modulos"] = [];
  const requisitosSugeridos: ProjectRepositorySurvey["requisitosSugeridos"] = [];
  const lacunas: ProjectRepositorySurvey["lacunas"] = [];

  if (macrobriefData.presente && macrobriefData.clusters.length > 0) {
    for (const cluster of macrobriefData.clusters) {
      modulos.push({
        id: cluster.id,
        nome: cluster.id.toUpperCase(),
        resumo: `Cluster ${cluster.id} derivado do macrobrief.`,
        arquivos: cluster.arquivos,
        proveniencia: "derivado_macrobrief",
      });

      for (const reqId of cluster.reqs) {
        const citedFiles = cluster.arquivos.length > 0 ? cluster.arquivos : arquivosFonte.slice(0, 1);
        requisitosSugeridos.push({
          id: reqId,
          titulo: `Requisito ${reqId}`,
          criterio: `Implementar ${reqId} abrangendo: ${citedFiles.join(", ")}.`,
          origem: `derivado: macrobrief ${reqId}`,
          proveniencia: "derivado_macrobrief",
        });
      }
    }
  } else {
    // Sem macrobrief: agrupar arquivos por prefixo de diretório
    const inferred = groupFilesByPrefix(arquivosFonte);
    modulos.push(...inferred);
  }

  // --- Verificação de Lacunas ---
  const moduleFiles = new Set(modulos.flatMap((m) => m.arquivos));
  for (const f of arquivosFonte) {
    if (!moduleFiles.has(f)) {
      lacunas.push({
        codigo: "arquivo_sem_modulo",
        detalhe: `O arquivo fonte "${f}" não pertence a nenhum módulo do levantamento.`,
      });
    }
  }

  // Módulos sem arquivos
  for (const m of modulos) {
    if (m.arquivos.length === 0) {
      lacunas.push({
        codigo: "modulo_sem_arquivo",
        detalhe: `O módulo "${m.nome || m.id}" não possui nenhum arquivo associado.`,
      });
    }
  }

  // Requisitos e cobertura de arquivos
  const citedFilesByReqs = new Set<string>();
  for (const req of requisitosSugeridos) {
    if (!req.criterio || !req.criterio.trim()) {
      lacunas.push({
        codigo: "req_sem_criterio",
        detalhe: `O requisito sugerido "${req.id}" está sem critério de aceitação.`,
      });
    }
    for (const f of arquivosFonte) {
      if (req.criterio.includes(f)) {
        citedFilesByReqs.add(f);
      }
    }
  }

  for (const f of arquivosFonte) {
    if (!citedFilesByReqs.has(f)) {
      lacunas.push({
        codigo: "arquivo_sem_req",
        detalhe: `O arquivo fonte "${f}" não está associado a nenhum requisito do levantamento.`,
      });
    }
  }

  // Rotas sem arquivo existente no disco
  for (const r of rotasApi) {
    const full = path.join(projectRoot, r.arquivo);
    if (!fs.existsSync(full)) {
      lacunas.push({
        codigo: "rota_sem_arquivo",
        detalhe: `A rota "${r.caminho}" aponta para "${r.arquivo}", inexistente no disco.`,
      });
    }
  }

  // Entidades vazias
  for (const e of entidades) {
    if (e.campos.length === 0) {
      lacunas.push({
        codigo: "entidade_vazia",
        detalhe: `A entidade Prisma "${e.nome}" não possui campos definidos.`,
      });
    }
  }

  // Se macrobrief presente, checar arquivos do macrobrief inexistentes no disco
  if (macrobriefData.presente) {
    for (const f of macrobriefData.arquivosMacrobrief) {
      const full = path.join(projectRoot, f);
      if (!fs.existsSync(full)) {
        lacunas.push({
          codigo: "spec_arquivo_inexistente_no_disco",
          detalhe: `Arquivo "${f}" citado no Macrobrief não existe no disco.`,
        });
      }
    }
  }

  return {
    projectRoot,
    levantadoEm: new Date().toISOString(),
    titulo,
    stack,
    arquivosFonte,
    rotasApi,
    entidades,
    modulos,
    requisitosSugeridos,
    macrobrief: {
      presente: macrobriefData.presente,
      specVersao: macrobriefData.specVersao,
      arquivosMacrobrief: macrobriefData.arquivosMacrobrief,
      reqsMacrobrief: macrobriefData.reqsMacrobrief,
    },
    lacunas,
  };
}
