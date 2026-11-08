import * as path from "path";
import * as fs from "fs";
import type {
  ParsedSpec,
  SpecFrontmatterInput,
  SpecModule,
  SpecRequirementItem,
  SpecRoute,
} from "./spec-format";
import { renderCanonicalSpecDocument } from "./spec-format";
import type {
  ProjectRepositorySurvey,
  SpecReconcileDelta,
} from "./project-repository-survey";

/**
 * Cria uma nova Spec canônica válida a partir do inventário mecânico.
 */
export function surveyToNewCanonicalSpec(survey: ProjectRepositorySurvey): string {
  const modulos: SpecModule[] = survey.modulos.map((m) => ({
    id: m.id,
    nome: m.nome,
    resumo: m.resumo,
    arquivos: [...m.arquivos],
  }));

  const rotas: SpecRoute[] = survey.rotasApi.map((r) => ({
    caminho: r.caminho,
    descricao: `Rota ${r.caminho} implementada em ${r.arquivo}.`,
  }));

  // Requisitos: usa sugeridos do macrobrief se houver; senão gera lista mínima para cobrir arquivos
  let requisitos: SpecRequirementItem[] = [];
  if (survey.requisitosSugeridos.length > 0) {
    requisitos = survey.requisitosSugeridos.map((r) => ({
      id: r.id,
      titulo: r.titulo,
      criterio: r.criterio,
      origem: r.origem,
    }));

    // Garante que todo arquivo em arquivosFonte seja citado por ao menos 1 REQ
    const citedFiles = new Set<string>();
    for (const req of requisitos) {
      for (const f of survey.arquivosFonte) {
        if (req.criterio.includes(f)) citedFiles.add(f);
      }
    }
    const uncited = survey.arquivosFonte.filter((f) => !citedFiles.has(f));
    let nextNum = requisitos.length + 1;
    for (const f of uncited) {
      requisitos.push({
        id: `REQ-${String(nextNum++).padStart(3, "0")}`,
        titulo: path.basename(f) || f,
        criterio: `${f} inventariado a partir do repositório.`,
        origem: "inferido: inventário de repositório",
      });
    }
  } else if (survey.arquivosFonte.length > 0) {
    requisitos = survey.arquivosFonte.map((arq, idx) => ({
      id: `REQ-${String(idx + 1).padStart(3, "0")}`,
      titulo: path.basename(arq) || arq,
      criterio: `${arq} implementado conforme inventário mecânico do repositório.`,
      origem: "inferido: inventário mecânico",
    }));
  }

  const specInput: SpecFrontmatterInput = {
    titulo: survey.titulo,
    status: "aguardando_aprovacao",
    data: new Date().toISOString().slice(0, 10),
    objetivo: `Documentar e estruturar o sistema a partir do inventário mecânico do repositório.`,
    stack: survey.stack,
    modulos,
    entidades: survey.entidades,
    rotas,
    arquivosAfetados: survey.arquivosFonte,
    notasImplementacao: [
      `[${new Date().toISOString()}] Spec inicial gerada pelo levantador de repositório.`,
    ],
    requisitosIds: requisitos.map((r) => r.id),
    requisitos,
  };

  return renderCanonicalSpecDocument(specInput);
}

/**
 * Política de merge de módulos:
 * Faz correspondência por ID ou por nome normalizado (case-insensitive).
 * Módulos só-humanos existentes são preservados, seus arquivos removidos do disco são filtrados,
 * e novos arquivos detectados são associados aos módulos existentes ou a novos módulos inferidos.
 */
export function reconcileParsedSpecWithSurvey(
  parsed: ParsedSpec,
  survey: ProjectRepositorySurvey
): { merged: SpecFrontmatterInput; delta: SpecReconcileDelta } {
  const delta: SpecReconcileDelta = {
    arquivosAdicionados: [],
    arquivosRemovidosNaSpec: [],
    rotasAdicionadas: [],
    stackAlterada: null,
    modulosAjustados: [],
    requisitosPreservados: [],
    requisitosNovos: [],
    avisos: [],
  };

  // 1. Arquivos afetados:
  const diskFiles = new Set(survey.arquivosFonte);
  const specFiles = new Set(parsed.arquivosAfetados);

  for (const f of survey.arquivosFonte) {
    if (!specFiles.has(f)) {
      delta.arquivosAdicionados.push(f);
    }
  }

  for (const f of parsed.arquivosAfetados) {
    const full = path.join(survey.projectRoot, f);
    if (!diskFiles.has(f) && !fs.existsSync(full)) {
      delta.arquivosRemovidosNaSpec.push(f);
    }
  }

  const removedSet = new Set(delta.arquivosRemovidosNaSpec);
  const mergedFilesSet = new Set<string>();
  for (const f of parsed.arquivosAfetados) {
    if (!removedSet.has(f)) mergedFilesSet.add(f);
  }
  for (const f of delta.arquivosAdicionados) {
    mergedFilesSet.add(f);
  }
  const mergedArquivosAfetados = Array.from(mergedFilesSet).sort();

  // 2. Stack:
  const oldStack = parsed.stack ?? [];
  const mergedStackSet = new Set([...oldStack, ...survey.stack]);
  const mergedStack = Array.from(mergedStackSet);
  if (
    mergedStack.length !== oldStack.length ||
    mergedStack.some((item, i) => item !== oldStack[i])
  ) {
    delta.stackAlterada = {
      antes: oldStack,
      depois: mergedStack,
    };
  }

  // 3. Rotas:
  const existingRoutesMap = new Map<string, SpecRoute>();
  for (const r of parsed.rotas) {
    existingRoutesMap.set(r.caminho, r);
  }

  for (const r of survey.rotasApi) {
    if (!existingRoutesMap.has(r.caminho)) {
      delta.rotasAdicionadas.push(r.caminho);
      existingRoutesMap.set(r.caminho, {
        caminho: r.caminho,
        descricao: `Rota detectada no repositório (${r.arquivo}).`,
      });
    }
  }
  const mergedRotas = Array.from(existingRoutesMap.values());

  // 4. Módulos:
  // Mapear módulos existentes por id e por nome normalizado
  const mergedModulos: SpecModule[] = [];
  const handledExistingModuleIds = new Set<string>();

  // Auxiliar para saber qual módulo da survey possui cada arquivo novo
  const surveyFileToModule = new Map<string, string>();
  for (const sm of survey.modulos) {
    for (const f of sm.arquivos) {
      surveyFileToModule.set(f, sm.id);
    }
  }

  for (const existingMod of parsed.modulos) {
    const normName = existingMod.nome.trim().toLowerCase();
    const matchingSurveyMod = survey.modulos.find(
      (sm) => sm.id === existingMod.id || sm.nome.trim().toLowerCase() === normName
    );

    const oldFiles = existingMod.arquivos ?? [];
    // Remove arquivos que saíram do disco
    let newFiles = oldFiles.filter((f) => !removedSet.has(f));

    // Adiciona arquivos novos que pertencem a este módulo segundo o levantamento
    if (matchingSurveyMod) {
      for (const addedFile of delta.arquivosAdicionados) {
        if (matchingSurveyMod.arquivos.includes(addedFile) && !newFiles.includes(addedFile)) {
          newFiles.push(addedFile);
        }
      }
    }

    const filesChanged =
      newFiles.length !== oldFiles.length ||
      newFiles.some((f, idx) => f !== oldFiles[idx]);

    if (filesChanged) {
      delta.modulosAjustados.push(existingMod.nome || existingMod.id);
    }

    mergedModulos.push({
      id: existingMod.id,
      nome: existingMod.nome,
      resumo: existingMod.resumo,
      arquivos: newFiles.sort(),
    });

    handledExistingModuleIds.add(existingMod.id);
  }

  // Se houver módulos no levantamento que não existem na Spec atual, adiciona-os
  for (const surveyMod of survey.modulos) {
    const normName = surveyMod.nome.trim().toLowerCase();
    const alreadyHandled = parsed.modulos.some(
      (m) => m.id === surveyMod.id || m.nome.trim().toLowerCase() === normName
    );

    if (!alreadyHandled) {
      // Arquivos deste módulo presentes em mergedArquivosAfetados
      const modFiles = surveyMod.arquivos.filter((f) => mergedArquivosAfetados.includes(f));
      if (modFiles.length > 0) {
        mergedModulos.push({
          id: surveyMod.id,
          nome: surveyMod.nome,
          resumo: surveyMod.resumo,
          arquivos: modFiles.sort(),
        });
        delta.modulosAjustados.push(surveyMod.nome || surveyMod.id);
      }
    }
  }

  // Assegura que todo arquivo de mergedArquivosAfetados pertença a pelo menos um módulo
  const allModuleFiles = new Set(mergedModulos.flatMap((m) => m.arquivos ?? []));
  const orphans = mergedArquivosAfetados.filter((f) => !allModuleFiles.has(f));
  if (orphans.length > 0) {
    if (mergedModulos.length > 0) {
      mergedModulos[0].arquivos = [...(mergedModulos[0].arquivos ?? []), ...orphans].sort();
      if (!delta.modulosAjustados.includes(mergedModulos[0].nome || mergedModulos[0].id)) {
        delta.modulosAjustados.push(mergedModulos[0].nome || mergedModulos[0].id);
      }
    } else {
      mergedModulos.push({
        id: "mod-geral",
        nome: "Módulo Geral",
        resumo: "Módulo geral contendo arquivos do projeto.",
        arquivos: orphans.sort(),
      });
      delta.modulosAjustados.push("Módulo Geral");
    }
  }

  // 5. Requisitos:
  // Preserva todos os requisitos existentes (id, titulo, criterio, origem)
  const existingReqs = parsed.requisitos ?? [];
  const mergedReqs: SpecRequirementItem[] = [];

  for (const req of existingReqs) {
    delta.requisitosPreservados.push(req.id);
    mergedReqs.push({ ...req });

    // Se o critério cita caminho que foi removido do disco:
    for (const removed of delta.arquivosRemovidosNaSpec) {
      if (
        (req.criterio && req.criterio.includes(removed)) ||
        (req.titulo && req.titulo.includes(removed))
      ) {
        delta.avisos.push(
          `O requisito "${req.id}" cita o arquivo "${removed}", que não existe mais no disco.`
        );
        survey.lacunas.push({
          codigo: "spec_arquivo_inexistente_no_disco",
          detalhe: `O requisito "${req.id}" cita o arquivo "${removed}", que não existe mais no disco.`,
        });
      }
    }
  }

  // Identifica arquivos não cobertos pelos REQs preservados
  const citedFilesByExistingReqs = new Set<string>();
  for (const req of mergedReqs) {
    for (const f of mergedArquivosAfetados) {
      if (req.criterio && req.criterio.includes(f)) {
        citedFilesByExistingReqs.add(f);
      }
    }
  }

  let nextReqIndex = mergedReqs.length + 1;
  for (const added of delta.arquivosAdicionados) {
    if (!citedFilesByExistingReqs.has(added)) {
      const newReqId = `REQ-${String(nextReqIndex++).padStart(3, "0")}`;
      const newReq: SpecRequirementItem = {
        id: newReqId,
        titulo: path.basename(added) || added,
        criterio: `${added} adicionado a partir do inventário do repositório.`,
        origem: "inferido: levantamento de repositório",
      };
      mergedReqs.push(newReq);
      delta.requisitosNovos.push(newReqId);
      citedFilesByExistingReqs.add(added);
    }
  }

  // 6. Entidades:
  const entityMap = new Map<string, { nome: string; campos: Array<{ nome: string; tipo: string }> }>();
  for (const e of parsed.entidades) {
    entityMap.set(e.nome, { nome: e.nome, campos: [...e.campos] });
  }
  for (const se of survey.entidades) {
    entityMap.set(se.nome, { nome: se.nome, campos: [...se.campos] });
  }
  const mergedEntidades = Array.from(entityMap.values());

  // 7. Status e Notas de Implementação:
  const hasMaterialChange =
    delta.arquivosAdicionados.length > 0 ||
    delta.arquivosRemovidosNaSpec.length > 0 ||
    delta.rotasAdicionadas.length > 0 ||
    delta.stackAlterada !== null ||
    delta.modulosAjustados.length > 0 ||
    delta.requisitosNovos.length > 0;

  const notasImplementacao = [...(parsed.notasImplementacao ?? [])];
  let status = parsed.status ?? "aguardando_aprovacao";

  if (hasMaterialChange) {
    status = "aguardando_aprovacao";
    notasImplementacao.push(
      `[${new Date().toISOString()}] Reconciliado com levantamento de repositório.`
    );
  }

  const merged: SpecFrontmatterInput = {
    titulo: parsed.titulo ?? survey.titulo,
    status,
    data: hasMaterialChange ? new Date().toISOString().slice(0, 10) : (parsed.data ?? new Date().toISOString().slice(0, 10)),
    objetivo: parsed.objetivo,
    stack: mergedStack,
    modulos: mergedModulos,
    entidades: mergedEntidades,
    rotas: mergedRotas,
    arquivosAfetados: mergedArquivosAfetados,
    notasImplementacao,
    requisitosIds: mergedReqs.map((r) => r.id),
    requisitos: mergedReqs,
  };

  return { merged, delta };
}

export function renderSurveyGapsMarkdown(survey: ProjectRepositorySurvey): string {
  const lines: string[] = [
    `# Relatório de Lacunas do Repositório: ${survey.titulo}`,
    "",
    `- **Data do levantamento:** ${survey.levantadoEm}`,
    `- **Raiz do projeto:** \`${survey.projectRoot}\``,
    `- **Arquivos-fonte encontrados:** ${survey.arquivosFonte.length}`,
    `- **Rotas API detectadas:** ${survey.rotasApi.length}`,
    `- **Entidades Prisma detectadas:** ${survey.entidades.length}`,
    `- **Módulos definidos:** ${survey.modulos.length}`,
    `- **Macrobrief presente:** ${survey.macrobrief.presente ? "Sim" : "Não"}`,
    "",
    "## Lacunas Identificadas",
    "",
  ];

  if (survey.lacunas.length === 0) {
    lines.push("Nenhuma lacuna detectada no inventário mecânico.");
  } else {
    lines.push("| Código | Detalhe |");
    lines.push("| --- | --- |");
    for (const lacuna of survey.lacunas) {
      lines.push(`| \`${lacuna.codigo}\` | ${lacuna.detalhe.replace(/\|/g, "\\|")} |`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

export function renderReconcileMarkdown(
  survey: ProjectRepositorySurvey,
  delta: SpecReconcileDelta | null
): string {
  const lines: string[] = [
    `# Relatório de Reconciliação de Spec: ${survey.titulo}`,
    "",
    `- **Data da reconciliação:** ${survey.levantadoEm}`,
    `- **Raiz do projeto:** \`${survey.projectRoot}\``,
    "",
  ];

  if (!delta) {
    lines.push("Nenhum delta gerado (modo criação direta ou levantamento sem alterações).");
    return lines.join("\n");
  }

  lines.push("## Resumo do Delta", "");

  lines.push("### Arquivos Adicionados");
  if (delta.arquivosAdicionados.length === 0) {
    lines.push("- Nenhum arquivo adicionado.");
  } else {
    for (const f of delta.arquivosAdicionados) lines.push(`- \`${f}\``);
  }
  lines.push("");

  lines.push("### Arquivos Removidos da Spec (ausentes no disco)");
  if (delta.arquivosRemovidosNaSpec.length === 0) {
    lines.push("- Nenhum arquivo removido.");
  } else {
    for (const f of delta.arquivosRemovidosNaSpec) lines.push(`- \`${f}\``);
  }
  lines.push("");

  lines.push("### Rotas Adicionadas");
  if (delta.rotasAdicionadas.length === 0) {
    lines.push("- Nenhuma nova rota adicionada.");
  } else {
    for (const r of delta.rotasAdicionadas) lines.push(`- \`${r}\``);
  }
  lines.push("");

  lines.push("### Stack");
  if (!delta.stackAlterada) {
    lines.push("- Sem alterações na stack.");
  } else {
    lines.push(`- Antes: ${delta.stackAlterada.antes.join(", ") || "(vazio)"}`);
    lines.push(`- Depois: ${delta.stackAlterada.depois.join(", ") || "(vazio)"}`);
  }
  lines.push("");

  lines.push("### Módulos Ajustados");
  if (delta.modulosAjustados.length === 0) {
    lines.push("- Nenhum módulo precisou de ajuste.");
  } else {
    for (const m of delta.modulosAjustados) lines.push(`- ${m}`);
  }
  lines.push("");

  lines.push("### Requisitos Preservados");
  if (delta.requisitosPreservados.length === 0) {
    lines.push("- Nenhum requisito anterior.");
  } else {
    lines.push(`- ${delta.requisitosPreservados.join(", ")}`);
  }
  lines.push("");

  lines.push("### Requisitos Novos");
  if (delta.requisitosNovos.length === 0) {
    lines.push("- Nenhum novo requisito gerado.");
  } else {
    lines.push(`- ${delta.requisitosNovos.join(", ")}`);
  }
  lines.push("");

  lines.push("### Avisos");
  if (delta.avisos.length === 0) {
    lines.push("- Nenhum aviso de inconsistência.");
  } else {
    for (const a of delta.avisos) lines.push(`- ⚠️ ${a}`);
  }
  lines.push("");

  return lines.join("\n");
}
