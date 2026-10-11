import {
  parseSpecDocument,
  renderCanonicalSpecDocument,
  type ParsedSpec,
  type SpecFrontmatterInput,
  type SpecRequirementItem,
} from "./spec-format";

/**
 * Verifica se um caminho aparenta ser um arquivo individual concreto (possui extensão).
 * Elimina diretórios soltos que o LLM às vezes lista (ex: "src/app/api").
 */
export function isConcreteFilePath(path: string): boolean {
  const clean = path.trim().replace(/\\/g, "/");
  if (!clean || clean.endsWith("/")) return false;
  const segments = clean.split("/");
  const lastSegment = segments[segments.length - 1];
  return lastSegment.includes(".") && !lastSegment.startsWith(".");
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

  // 5. Renderiza a Spec canônica corrigida
  const frontmatterInput: SpecFrontmatterInput = {
    titulo: spec.titulo || "Projeto NextCode",
    status: "aguardando_aprovacao",
    data: spec.data || new Date().toISOString().split("T")[0],
    objetivo: healedObjetivo,
    stack: spec.stack.length > 0 ? spec.stack : ["Next.js (App Router)", "TypeScript", "Tailwind CSS"],
    modulos: healedModulos,
    entidades: spec.entidades,
    rotas: spec.rotas,
    arquivosAfetados: cleanFiles,
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
