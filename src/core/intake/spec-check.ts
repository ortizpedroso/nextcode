/**
 * Conferência mecânica da Spec (P12: "bater um artefato com outro é conferência mecânica, não
 * opinião de LLM"). Roda antes de mostrar a Spec ao usuário. Motivo (teste de 06/10): a Spec da
 * API de tarefas declarou o módulo TaskRepository sem arquivo; as duas rotas não teriam a lista
 * em memória compartilhada e o PATCH responderia sempre 404 — e a trava de escopo (T2) impediria
 * o executor de criar o arquivo que faltava.
 */
import type { ParsedSpec } from "./spec-format";

/** Caminhos de arquivo que atendem uma rota HTTP: App Router (route.ts) ou Pages Router. */
export function routeFileCandidates(caminho: string): string[] {
  const clean = caminho.trim().replace(/\?.*$/, "").replace(/\/+$/, "");
  if (!clean.startsWith("/")) return [];
  const segs = clean
    .split("/")
    .filter(Boolean)
    .map((s) => (s.startsWith(":") ? `[${s.slice(1)}]` : s.replace(/^\{(.+)\}$/, "[$1]")));
  const rel = segs.join("/");
  const out: string[] = [];
  for (const base of ["src/app", "app"]) out.push(`${base}/${rel}/route.ts`, `${base}/${rel}/route.tsx`, `${base}/${rel}/page.tsx`);
  for (const base of ["src/pages", "pages"]) out.push(`${base}/${rel}.ts`, `${base}/${rel}.tsx`, `${base}/${rel}/index.ts`, `${base}/${rel}/index.tsx`);
  return out;
}

const PLACEHOLDER_OBJECTIVE = /^(especifica[cç][aã]o atualizada\.?|<.*>)?$/i;

/** Problemas estruturais que impedem a execução correta; lista vazia = Spec consistente. */
export function checkSpecStructure(spec: ParsedSpec): string[] {
  const problems: string[] = [];
  const files = new Set(spec.arquivosAfetados.map((f) => f.trim()));

  if (spec.modulos.length === 0) problems.push("A Spec não declara nenhum módulo.");
  if (files.size === 0) problems.push("A Spec não declara nenhum arquivo em arquivos_afetados.");

  for (const m of spec.modulos) {
    if (!m.arquivos || m.arquivos.length === 0) {
      problems.push(`O módulo "${m.nome || m.id}" não tem arquivos: declare em "arquivos" quais arquivos o implementam.`);
    }
  }

  const moduleFiles = new Set(spec.modulos.flatMap((m) => m.arquivos ?? []));
  if (spec.modulos.every((m) => (m.arquivos ?? []).length > 0)) {
    for (const f of files) {
      if (!moduleFiles.has(f)) problems.push(`O arquivo "${f}" não pertence a nenhum módulo.`);
    }
  }

  for (const r of spec.rotas) {
    if (!r.caminho.trim().startsWith("/")) continue;
    const candidates = routeFileCandidates(r.caminho);
    if (candidates.length && !candidates.some((c) => files.has(c))) {
      problems.push(`A rota "${r.caminho}" não tem arquivo de rota (ex.: ${candidates[0]}).`);
    }
  }

  if (PLACEHOLDER_OBJECTIVE.test(spec.objetivo.trim())) {
    problems.push("O texto de objetivo da Spec (parágrafo após o título) está vazio.");
  }

  const reqs = spec.requisitos ?? [];
  if (reqs.length === 0) {
    problems.push(
      "A Spec não declara nenhum requisito em requisitos (declare REQ-001, REQ-002… com titulo e criterio citando o arquivo)."
    );
  } else {
    const seenIds = new Set<string>();
    const filesArr = Array.from(files);
    const normFiles = filesArr.map((f) => f.replace(/\\/g, "/"));
    const citedNormFiles = new Set<string>();

    reqs.forEach((req, idx) => {
      const id = (req.id || "").trim();
      const expectedId = `REQ-${String(idx + 1).padStart(3, "0")}`;
      if (seenIds.has(id)) {
        problems.push(`O requisito "${id}" está duplicado.`);
      }
      if (id) seenIds.add(id);
      if (id !== expectedId) {
        problems.push(
          `O requisito na posição ${idx + 1} tem id "${id || "(vazio)"}" fora de sequência (esperado "${expectedId}").`
        );
      }

      if (filesArr.length > 0) {
        const normCriterio = (req.criterio || "").replace(/\\/g, "/");
        const matched = normFiles.filter((nf) => normCriterio.includes(nf));
        if (matched.length === 0) {
          problems.push(
            `O critério do requisito "${id || req.titulo}" não cita nenhum arquivo de arquivos_afetados.`
          );
        } else {
          for (const mf of matched) citedNormFiles.add(mf);
        }
      }
    });

    if (filesArr.length > 0) {
      for (const f of filesArr) {
        const nf = f.replace(/\\/g, "/");
        if (!citedNormFiles.has(nf)) {
          problems.push(
            `O arquivo "${f}" de arquivos_afetados não é citado por nenhum requisito em requisitos.`
          );
        }
      }
    }
  }

  // SM1 (b) / T8a: arquivo citado por um REQ tem de estar em arquivos_afetados — senão nenhuma etapa
  // o escreve e o REQ fica impossível (teste real: REQ-002 exigia `vitest.config.ts`, fora da lista).
  for (const req of spec.requisitos ?? []) {
    for (const cited of citedFilePaths(`${req.titulo} ${req.criterio}`)) {
      const known = Array.from(files).some((f) => {
        const nf = f.replace(/\\/g, "/").replace(/^(?:\.\/)+/, "");
        return nf === cited || nf.endsWith(`/${cited}`) || cited.endsWith(`/${nf}`);
      });
      if (!known) {
        problems.push(
          `O requisito "${req.id}" cita o arquivo "${cited}", que não está em arquivos_afetados: acrescente-o (e a um módulo) ou tire a citação.`
        );
      }
    }
  }

  return problems;
}

/**
 * Caminhos de arquivo citados num texto — mesma regra de `extractFilePathsFromCriteriaText`
 * (`jev-execution-checks.ts`), repetida aqui para não criar import circular com o intake.
 */
const CITED_FILE_RE = /(?:[A-Za-z0-9_$@.()[\]-]+\/)+[A-Za-z0-9_$@.-]+\.[A-Za-z0-9]+|\b[A-Za-z0-9_$@.-]+\.config\.[A-Za-z0-9]+\b/g;
export function citedFilePaths(text: string): string[] {
  const found = new Set<string>();
  for (const m of (text || "").matchAll(CITED_FILE_RE)) {
    const p = m[0].replace(/\\/g, "/").replace(/^(?:\.\/)+/, "").trim();
    if (p) found.add(p);
  }
  return Array.from(found);
}
