/**
 * Macrobrief do elicitador: um documento Markdown com frontmatter YAML.
 * Clusters, arquivos da Spec, REQ dono e dependência entre clusters.
 * O contrato TypeScript e o corte em etapas ficam com o analista, depois do laudo.
 */

import type { ClusterKind } from "@/core/config/orchestration-policy";
import { extractFilePathsFromCriteriaText } from "@/core/decision/jev-execution-checks";
import { parseYamlFrontmatter, type YamlValue } from "@/core/intake/spec-format";
import type { ParsedSpec } from "@/core/intake/spec-format";
import { inferClusterFromFilePath, type MacrobriefDocument } from "@/core/templates/artifact-templates";

export const CLUSTERS_MACROBRIEF: ClusterKind[] = ["core", "backend", "integration", "frontend"];

export interface ClusterDoMacrobrief {
  id: ClusterKind;
  arquivos: string[];
  reqs: string[];
  dependeDe: ClusterKind[];
}

export interface ElicitadorMacrobrief {
  documento: "macrobrief";
  specVersao: number;
  clustersAtivos: ClusterKind[];
  clusters: ClusterDoMacrobrief[];
  requisitos: string[];
}

export type MacrobriefClassificado =
  | { tipo: "pausa"; motivo: string }
  | { tipo: "reprovado"; erros: string[] }
  | { tipo: "valido"; doc: ElicitadorMacrobrief; texto: string };

function normPath(file: string): string {
  return file.replace(/\\/g, "/").replace(/^(?:\.\/)+/, "").trim();
}

function asStringList(v: YamlValue | undefined): string[] {
  if (Array.isArray(v)) {
    return v.filter((x): x is string => typeof x === "string").map((s) => s.trim()).filter((s) => s !== "[]");
  }
  if (typeof v === "string") {
    const t = v.trim();
    if (!t || t === "[]") return [];
    return t
      .split(",")
      .map((s) => s.trim().replace(/^\[/, "").replace(/\]$/, "").replace(/^["']|["']$/g, "").trim())
      .filter(Boolean);
  }
  return [];
}

function asMaps(v: YamlValue | undefined): Record<string, YamlValue>[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is Record<string, YamlValue> => typeof x === "object" && x !== null && !Array.isArray(x));
}

export function renderElicitadorMacrobrief(doc: ElicitadorMacrobrief): string {
  const lines: string[] = [
    "---",
    "documento: macrobrief",
    `spec_versao: ${doc.specVersao}`,
    "clusters_ativos:",
    ...doc.clustersAtivos.map((c) => `  - ${c}`),
    "clusters:",
  ];
  for (const c of doc.clusters) {
    lines.push(`  - id: ${c.id}`);
    if (c.arquivos.length === 0) lines.push("    arquivos: []");
    else {
      lines.push("    arquivos:");
      for (const f of c.arquivos) lines.push(`      - ${f}`);
    }
    if (c.reqs.length === 0) lines.push("    reqs: []");
    else {
      lines.push("    reqs:");
      for (const r of c.reqs) lines.push(`      - ${r}`);
    }
    if (c.dependeDe.length === 0) lines.push("    depende_de: []");
    else {
      lines.push("    depende_de:");
      for (const d of c.dependeDe) lines.push(`      - ${d}`);
    }
  }
  lines.push("---", "", "# Macrobrief", "");
  for (const c of doc.clusters) {
    const dep = c.dependeDe.length > 0 ? ` Depende de ${c.dependeDe.join(", ")}.` : "";
    lines.push(`O cluster \`${c.id}\` é dono de ${c.arquivos.join(", ")} e de ${c.reqs.join(", ") || "nenhum REQ"}.${dep}`);
  }
  lines.push("");
  return lines.join("\n");
}

export function parseElicitadorMacrobrief(content: string): ElicitadorMacrobrief | null {
  const parsed = parseYamlFrontmatter(content);
  if (!parsed) return null;
  if (parsed.root.documento !== "macrobrief" && !Array.isArray(parsed.root.clusters)) return null;
  const clusters: ClusterDoMacrobrief[] = [];
  for (const raw of asMaps(parsed.root.clusters)) {
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    if (!CLUSTERS_MACROBRIEF.includes(id as ClusterKind)) return null;
    clusters.push({
      id: id as ClusterKind,
      arquivos: asStringList(raw.arquivos).map(normPath),
      reqs: asStringList(raw.reqs).map((r) => r.toUpperCase()),
      dependeDe: asStringList(raw.depende_de ?? raw.dependeDe).filter((d): d is ClusterKind =>
        CLUSTERS_MACROBRIEF.includes(d as ClusterKind)
      ),
    });
  }
  if (clusters.length === 0) return null;
  const versaoBruta = parsed.root.spec_versao;
  const specVersao = typeof versaoBruta === "string" || typeof versaoBruta === "number" ? Number(versaoBruta) || 1 : 1;
  const ativos = asStringList(parsed.root.clusters_ativos).filter((c): c is ClusterKind =>
    CLUSTERS_MACROBRIEF.includes(c as ClusterKind)
  );
  return {
    documento: "macrobrief",
    specVersao,
    clustersAtivos: ativos.length > 0 ? ativos : clusters.map((c) => c.id),
    clusters,
    requisitos: clusters.flatMap((c) => c.reqs),
  };
}

export function validarElicitadorMacrobrief(
  doc: ElicitadorMacrobrief,
  arquivosSpec: string[],
  reqIds: string[]
): string[] {
  const errors: string[] = [];
  const specFiles = new Set(arquivosSpec.map(normPath));
  const specReqs = new Set(reqIds);
  const fileOwner = new Map<string, ClusterKind>();
  const reqOwner = new Map<string, ClusterKind>();
  const ids = new Set(doc.clusters.map((c) => c.id));

  if (new Set(doc.clusters.map((c) => c.id)).size !== doc.clusters.length) {
    errors.push("[MACROBRIEF] Cluster repetido.");
  }

  for (const c of doc.clusters) {
    for (const f of c.arquivos) {
      if (!specFiles.has(f)) {
        errors.push(`[MACROBRIEF] Arquivo "${f}" não está na Spec.`);
      }
      const prev = fileOwner.get(f);
      if (prev && prev !== c.id) {
        errors.push(`[MACROBRIEF] Arquivo "${f}" está em ${prev} e em ${c.id}.`);
      } else {
        fileOwner.set(f, c.id);
      }
    }
    for (const r of c.reqs) {
      if (!specReqs.has(r)) {
        errors.push(`[MACROBRIEF] ${r} não existe na Spec.`);
      }
      const prev = reqOwner.get(r);
      if (prev && prev !== c.id) {
        errors.push(`[MACROBRIEF] ${r} está em ${prev} e em ${c.id}.`);
      } else {
        reqOwner.set(r, c.id);
      }
    }
    for (const d of c.dependeDe) {
      if (d === c.id || !ids.has(d)) {
        errors.push(`[MACROBRIEF] ${c.id} depende de "${d}", que não é um cluster deste Macrobrief.`);
      }
    }
  }

  for (const f of specFiles) {
    if (!fileOwner.has(f)) errors.push(`[MACROBRIEF] O arquivo "${f}" da Spec não tem cluster.`);
  }
  for (const r of specReqs) {
    if (!reqOwner.has(r)) errors.push(`[MACROBRIEF] ${r} não tem cluster.`);
  }

  const color = new Map<ClusterKind, 0 | 1 | 2>();
  for (const c of doc.clusters) color.set(c.id, 0);
  const byId = new Map(doc.clusters.map((c) => [c.id, c]));
  const walk = (id: ClusterKind, path: ClusterKind[]): void => {
    color.set(id, 1);
    for (const d of byId.get(id)?.dependeDe ?? []) {
      const mark = color.get(d) ?? 0;
      if (mark === 1) {
        errors.push(`[MACROBRIEF] Ciclo de clusters: ${[...path, d].join(" -> ")}.`);
        continue;
      }
      if (mark === 0) walk(d, [...path, d]);
    }
    color.set(id, 2);
  };
  for (const c of doc.clusters) {
    if ((color.get(c.id) ?? 0) === 0) walk(c.id, [c.id]);
  }
  return errors;
}

export function classificarTextoDeMacrobrief(
  content: string | null | undefined,
  arquivosSpec: string[],
  reqIds: string[]
): MacrobriefClassificado {
  if (!content?.trim()) {
    return { tipo: "pausa", motivo: "O elicitador não devolveu o Macrobrief." };
  }
  const doc = parseElicitadorMacrobrief(content);
  if (!doc) {
    return { tipo: "pausa", motivo: "O Macrobrief não está em Markdown com frontmatter YAML." };
  }
  const erros = validarElicitadorMacrobrief(doc, arquivosSpec, reqIds);
  if (erros.length > 0) return { tipo: "reprovado", erros };
  const texto = parseYamlFrontmatter(content)?.texto ?? renderElicitadorMacrobrief(doc);
  return { tipo: "valido", doc, texto };
}

function dependeDoCluster(id: ClusterKind, presentes: Set<ClusterKind>): ClusterKind[] {
  if (id === "backend" || id === "integration") return presentes.has("core") ? ["core"] : [];
  if (id === "frontend") {
    if (presentes.has("backend")) return ["backend"];
    if (presentes.has("core")) return ["core"];
  }
  return [];
}

/** Documento fixo da Spec, usado quando o modelo do elicitador não é chamado. */
export function macrobriefFixoDaSpec(spec: ParsedSpec): { doc: ElicitadorMacrobrief; texto: string } {
  const arquivos = (spec.arquivosAfetados ?? []).map(normPath).filter(Boolean);
  const reqs =
    spec.requisitos && spec.requisitos.length > 0
      ? spec.requisitos
      : (spec.requisitosIds ?? []).map((id) => ({ id, titulo: "", criterio: "" }));
  const porCluster = new Map<ClusterKind, string[]>();
  for (const f of arquivos) {
    const c = inferClusterFromFilePath(f);
    const lista = porCluster.get(c) ?? [];
    lista.push(f);
    porCluster.set(c, lista);
  }
  if (porCluster.size === 0) porCluster.set("core", []);
  const presentes = new Set(porCluster.keys());
  const reqsPorCluster = new Map<ClusterKind, string[]>();
  for (const id of presentes) reqsPorCluster.set(id, []);
  const primeiro = CLUSTERS_MACROBRIEF.find((c) => presentes.has(c)) ?? "core";
  for (const r of reqs) {
    const citado = extractFilePathsFromCriteriaText(`${r.titulo} ${r.criterio}`).map(normPath);
    const hit = citado.find((f) => porCluster.has(inferClusterFromFilePath(f)) && arquivos.includes(f));
    const cluster = hit ? inferClusterFromFilePath(hit) : primeiro;
    const lista = reqsPorCluster.get(cluster) ?? [];
    lista.push(r.id);
    reqsPorCluster.set(cluster, lista);
    if (!presentes.has(cluster)) {
      presentes.add(cluster);
      porCluster.set(cluster, porCluster.get(cluster) ?? []);
    }
  }
  const clusters: ClusterDoMacrobrief[] = CLUSTERS_MACROBRIEF.filter((id) => presentes.has(id)).map((id) => ({
    id,
    arquivos: porCluster.get(id) ?? [],
    reqs: reqsPorCluster.get(id) ?? [],
    dependeDe: dependeDoCluster(id, presentes),
  }));
  const doc: ElicitadorMacrobrief = {
    documento: "macrobrief",
    specVersao: 1,
    clustersAtivos: clusters.map((c) => c.id),
    clusters,
    requisitos: clusters.flatMap((c) => c.reqs),
  };
  return { doc, texto: renderElicitadorMacrobrief(doc) };
}

export function documentoDeMacrobrief(doc: ElicitadorMacrobrief, titulo: string | null): MacrobriefDocument {
  const slug = (titulo || "projeto").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return {
    documento: "macrobrief",
    idMacrobrief: "macro-elicitador",
    idProjeto: slug,
    specVersao: doc.specVersao,
    requisitosTotais: [...doc.requisitos],
    clustersAtivos: [...doc.clustersAtivos],
    microbriefs: doc.clusters.map((c) => ({
      id: c.id,
      cluster: c.id,
      dependeDe: [...c.dependeDe],
      arquivos: [...c.arquivos],
      reqs: [...c.reqs],
    })),
    contratosTypescript: "",
  };
}

export function textoParaOConferente(spec: string, macrobriefTexto: string): string {
  return `SPEC APROVADA\n\n${spec.trim()}\n\nMACROBRIEF\n\n${macrobriefTexto.trim()}`;
}

export function errosDePlanoContraMacrobrief(
  stages: Array<{ id: string; arquivos: string[]; reqs: string[] }>,
  clusters: Record<string, ClusterKind>,
  macro: ElicitadorMacrobrief
): string[] {
  const donoArquivo = new Map<string, ClusterKind>();
  const donoReq = new Map<string, ClusterKind>();
  for (const c of macro.clusters) {
    for (const f of c.arquivos) donoArquivo.set(normPath(f), c.id);
    for (const r of c.reqs) donoReq.set(r, c.id);
  }
  const errors: string[] = [];
  for (const stage of stages) {
    const cluster = clusters[stage.id];
    for (const f of stage.arquivos) {
      const esperado = donoArquivo.get(normPath(f));
      if (esperado && cluster !== esperado) {
        errors.push(
          `[MACROBRIEF] O arquivo "${f}" pertence ao cluster ${esperado} no Macrobrief aprovado. A etapa "${stage.id}" o colocou em ${cluster}.`
        );
      }
    }
    for (const r of stage.reqs) {
      const esperado = donoReq.get(r);
      if (esperado && cluster !== esperado) {
        errors.push(
          `[MACROBRIEF] ${r} pertence ao cluster ${esperado} no Macrobrief aprovado. A etapa "${stage.id}" o colocou em ${cluster}.`
        );
      }
    }
  }
  return errors;
}
