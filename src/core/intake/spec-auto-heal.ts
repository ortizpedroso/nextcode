import {
  parseSpecDocument,
  renderCanonicalSpecDocument,
  type ParsedSpec,
  type SpecFrontmatterInput,
  type SpecRequirementItem,
} from "./spec-format";

/** Nomes de arquivo válidos sem extensão (deploy / build). Fase D Gateway: Dockerfile e Caddyfile. */
const EXTENSIONLESS_FILE_BASENAMES = new Set([
  "Dockerfile",
  "Makefile",
  "makefile",
  "Caddyfile",
  "LICENSE",
  "Containerfile",
]);

/**
 * Verifica se um caminho aparenta ser um arquivo individual concreto (possui extensão ou nome allowlist).
 * Elimina diretórios soltos que o LLM às vezes lista (ex: "src/app/api").
 */
export function isConcreteFilePath(path: string): boolean {
  const clean = path.trim().replace(/\\/g, "/");
  if (!clean || clean.endsWith("/")) return false;
  const segments = clean.split("/");
  const lastSegment = segments[segments.length - 1];
  if (/^Dockerfile(\.[a-zA-Z0-9._-]+)?$/.test(lastSegment)) return true;
  if (EXTENSIONLESS_FILE_BASENAMES.has(lastSegment)) return true;
  if (!lastSegment.includes(".")) return false;
  // SM1 (a): arquivo com ponto no início vale se tiver extensão (".env.example", ".eslintrc.json").
  // Antes era descartado calado — teste real `934939fc`: `.env.example` pedido 2× e removido 3×.
  if (lastSegment.startsWith(".")) return lastSegment.indexOf(".", 1) > 0;
  return true;
}

/** SM1 (c): data da Spec é carimbada pelo NextCode (dia local), não escrita pelo modelo. */
export function specDateToday(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Auto-cura mecânica determinística da Spec.
 * Corrige problemas estruturais comuns sem transferir o trabalho para o usuário:
 * 1. Sanitiza `arquivos_afetados`: remove pastas e caminhos que não são arquivos.
 * 2. Garante que todo arquivo de `arquivos_afetados` pertença a pelo menos um módulo.
 * 3. Auto-gera requisitos `REQ-001...` caso a LLM tenha omitido a seção.
 * 4. Preenche objetivo caso esteja vazio ou com texto de placeholder.
 */
export function autoHealSpecDocument(rawOrParsed: string | ParsedSpec): {
  healedSpec: string;
  parsed: ParsedSpec;
  fixesApplied: string[];
} {
  const spec: ParsedSpec | null =
    typeof rawOrParsed === "string" ? parseSpecDocument(rawOrParsed) : rawOrParsed;

  if (!spec) {
    throw new Error("Não foi possível realizar parse da Spec para auto-cura.");
  }

  const fixesApplied: string[] = [];

  // 1. Sanitiza arquivos_afetados (remove diretórios sem extensão)
  let cleanFiles = spec.arquivosAfetados.filter((f) => {
    if (isConcreteFilePath(f)) return true;
    fixesApplied.push(`Removido diretório ou caminho inválido de arquivos_afetados: "${f}"`);
    return false;
  });

  // Também assegura que todos os arquivos declarados nos módulos estejam em arquivos_afetados
  const moduleFiles = new Set<string>();
  spec.modulos.forEach((m) => {
    (m.arquivos ?? []).forEach((f) => {
      if (isConcreteFilePath(f)) {
        moduleFiles.add(f);
      }
    });
  });

  moduleFiles.forEach((mf) => {
    if (!cleanFiles.includes(mf)) {
      cleanFiles.push(mf);
      fixesApplied.push(`Adicionado arquivo de módulo ausente em arquivos_afetados: "${mf}"`);
    }
  });

  // 2. Garante que todo arquivo em arquivos_afetados pertença a pelo menos um módulo
  const healedModulos = spec.modulos.map((m) => ({
    ...m,
    arquivos: (m.arquivos ?? []).filter(isConcreteFilePath),
  }));

  const coveredByModules = new Set(healedModulos.flatMap((m) => m.arquivos ?? []));
  cleanFiles.forEach((file) => {
    if (!coveredByModules.has(file)) {
      // Associa ao primeiro módulo que tiver nome afim ou ao primeiro módulo geral
      let targetModule = healedModulos.find((m) => {
        const idLower = m.id.toLowerCase();
        return file.toLowerCase().includes(idLower);
      });
      if (!targetModule && healedModulos.length > 0) {
        targetModule = healedModulos[0];
      }
      if (targetModule) {
        targetModule.arquivos = targetModule.arquivos ?? [];
        targetModule.arquivos.push(file);
        coveredByModules.add(file);
        fixesApplied.push(
          `Arquivo solto "${file}" associado automaticamente ao módulo "${targetModule.nome || targetModule.id}".`
        );
      }
    }
  });

  // 3. Auto-sintetiza requisitos REQ-xxx caso estejam ausentes ou incompletos
  let healedReqs: SpecRequirementItem[] = spec.requisitos ? [...spec.requisitos] : [];
  if (healedReqs.length === 0) {
    fixesApplied.push("Seção de requisitos estava ausente; auto-gerados requisitos rastreáveis a partir dos módulos.");
    let reqIndex = 1;

    healedModulos.forEach((m) => {
      const filesForModule = m.arquivos && m.arquivos.length > 0 ? m.arquivos : [];
      if (filesForModule.length > 0) {
        filesForModule.forEach((filePath) => {
          const reqId = `REQ-${String(reqIndex++).padStart(3, "0")}`;
          healedReqs.push({
            id: reqId,
            titulo: `${m.nome} (${filePath.split("/").pop()})`,
            criterio: `${filePath} implementa componentes e regras do módulo "${m.nome}".`,
          });
        });
      } else {
        const reqId = `REQ-${String(reqIndex++).padStart(3, "0")}`;
        healedReqs.push({
          id: reqId,
          titulo: `Módulo ${m.nome}`,
          criterio: `Implementação completa das funcionalidades de ${m.nome} conforme especificação.`,
        });
      }
    });
  } else {
    // Garante IDs sequenciais estritos REQ-001, REQ-002...
    healedReqs = healedReqs.map((req, idx) => {
      const expectedId = `REQ-${String(idx + 1).padStart(3, "0")}`;
      if (req.id !== expectedId) {
        fixesApplied.push(`Corrigido id do requisito de "${req.id}" para "${expectedId}".`);
        return { ...req, id: expectedId };
      }
      return req;
    });

    // Garante que todo arquivo em arquivos_afetados seja citado por pelo menos um requisito
    const allReqCriteria = healedReqs.map((r) => r.criterio || "").join(" ");
    let nextIdx = healedReqs.length + 1;
    cleanFiles.forEach((f) => {
      if (!allReqCriteria.includes(f)) {
        const newReqId = `REQ-${String(nextIdx++).padStart(3, "0")}`;
        healedReqs.push({
          id: newReqId,
          titulo: `Implementação e testes de ${f.split("/").pop()}`,
          criterio: `${f} implementa regras e contratos associados.`,
        });
        fixesApplied.push(`Adicionado requisito "${newReqId}" cobrindo o arquivo "${f}".`);
      }
    });
  }

  // 4. Preenche objetivo caso vazio ou placeholder
  let healedObjetivo = spec.objetivo.trim();
  const isPlaceholder = !healedObjetivo || /^(especifica[cç][aã]o atualizada\.?|<.*>)?$/i.test(healedObjetivo);
  if (isPlaceholder) {
    const modulesSummary = healedModulos.map((m) => m.nome).filter(Boolean).slice(0, 5).join(", ");
    healedObjetivo = `Especificação completa de ${spec.titulo || "software"}. Inclui módulos estruturados para ${modulesSummary}, com regras de negócio, dados relacionais e contratos testáveis.`;
    fixesApplied.push("Preenchido objetivo executivo a partir do escopo dos módulos.");
  }

  // 5. SM1 (c): data carimbada pelo harness (teste real 16/10: o modelo escreveu 2025-10-16)
  const hoje = specDateToday();
  if (spec.data && spec.data.trim() !== hoje) {
    fixesApplied.push(`Data da Spec corrigida para ${hoje} (o modelo escreveu "${spec.data.trim()}").`);
  }

  const requisitosIds =
    spec.requisitosIds && spec.requisitosIds.length > 0
      ? spec.requisitosIds
      : healedReqs.map((r) => r.id).filter(Boolean);
  if (healedReqs.length > 0 && !(spec.requisitosIds?.length)) {
    fixesApplied.push(
      `requisitos_ids preenchido automaticamente a partir de requisitos (${requisitosIds.length} ids).`
    );
  }

  // 6. Renderiza a Spec canônica corrigida
  const frontmatterInput: SpecFrontmatterInput = {
    titulo: spec.titulo || "Projeto NextCode",
    status: "aguardando_aprovacao",
    data: specDateToday(),
    objetivo: healedObjetivo,
    stack: spec.stack.length > 0 ? spec.stack : ["Next.js (App Router)", "TypeScript", "Tailwind CSS"],
    modulos: healedModulos,
    entidades: spec.entidades,
    rotas: spec.rotas,
    arquivosAfetados: cleanFiles,
    requisitosIds,
    requisitos: healedReqs,
    notasImplementacao: spec.notasImplementacao,
  };

  const canonicalDocument = renderCanonicalSpecDocument(frontmatterInput);
  const parsedCanonical = parseSpecDocument(canonicalDocument)!;

  return {
    healedSpec: canonicalDocument,
    parsed: parsedCanonical,
    fixesApplied,
  };
}
