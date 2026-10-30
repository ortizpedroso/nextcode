import { fileOfRef, type FinalDefect } from "@/core/governance/final-reviewer";
import { formatTriageForHumans, type DeliveryTriageSummary } from "@/core/orchestrator/delivery-triage";

/**
 * Mudança 43.4 — o aviso de entrega reprovada é montado com o diagnóstico (não com frase fixa). Fundador
 * 22/10: "essa resposta deve ser mais clara e objetiva… ele invalida a spec e todo o trabalho". Diz o que
 * sobrou, com prova; se a Spec está certa; o progresso das rodadas; e escolhe o caminho: rodadas gastas com
 * defeito só de código e com dona → Autorizar mais uma rodada; pergunta de Spec → a pergunta exata.
 */
export interface DeliveryDiagnosisInput {
  defeitos: FinalDefect[];
  perguntasSpec: string[];
  /** Lacunas que não vieram da revisão final (arquivo ausente, tela, build…). */
  outrasLacunas: string[];
  /** Quantos defeitos a revisão final achou em cada verificação, na ordem. */
  progresso: number[];
  /** Resultado do reparo que não abriu. */
  reparo: { tipo: "esgotado" | "sem_dono" | "erro"; motivo: string; todosComDono?: boolean };
  /** Triagem automática das lacunas (T10) — roteia o próximo passo humano. */
  triagem?: DeliveryTriageSummary;
}

export interface DeliveryDiagnosis {
  evento: "REPARO_ESGOTADO" | "VERIFICACAO_COM_LACUNAS";
  detalhe: string;
}

const firstLine = (s?: string) => (s ?? "").split("\n").find((l) => l.trim())?.trim().slice(0, 220) ?? "";

/** Fundador 30/10 (E5-D2/D4): importante da J3 com arquivo no disco — sem teste reproduzido não vira ENTREGUE silencioso. */
export function isImportantDefectAnchored(d: FinalDefect): boolean {
  return d.defeito.startsWith("revisão final [importante]") && Boolean(d.arquivo?.trim());
}

function linhaDefeito(d: FinalDefect): string {
  const onde = d.arquivo ? `\`${d.arquivo}\`` : "(sem arquivo)";
  const req = d.req ? `${d.req} · ` : "";
  if (d.prova === "reproduzido" && d.teste) {
    return `- ${req}${onde} · teste \`${d.teste.caminho}\` falha: ${firstLine(d.saida)}`;
  }
  return `- ${req}${onde} · ${d.defeito.replace(/^revisão final:\s*/, "").slice(0, 220)}`;
}

/**
 * Mudança 44 — entrega decidida pela prova (fundador 22/10: "não quero ajuste para passar nos testes, quero
 * resultado melhor; se está muito rígido, vamos ajustar"). Reprova a entrega: defeito com teste que falha,
 * `critico` (segurança/dinheiro, mesmo sem teste) e defeito sem bancada (Docker fora — não há como provar,
 * fica o comportamento antigo). Defeito só de leitura (sem teste possível, ex.: tela) acompanha o reparo
 * enquanto houver defeito provado; sozinho, vira ressalva da entrega. Pergunta de Spec nunca trava código.
 * `importante` ancorado (arquivo) sem prova reproduzida bloqueia entrega (decisão fundador 30/10).
 */
export function splitDefectsByEvidence(defeitos: FinalDefect[]): { bloqueiam: FinalDefect[]; leitura: FinalDefect[]; spec: FinalDefect[] } {
  const spec = defeitos.filter((d) => d.prova === "spec");
  const bloqueiam = defeitos.filter(
    (d) =>
      d.prova !== "spec" &&
      (d.prova === "reproduzido" ||
        d.prova === undefined ||
        d.defeito.startsWith("revisão final [critico]") ||
        isImportantDefectAnchored(d))
  );
  const leitura = defeitos.filter((d) => d.prova !== "spec" && !bloqueiam.includes(d));
  return { bloqueiam, leitura, spec };
}

/** Problemas `importante` da revisão final como defeitos de leitura (sem repetir o que já é defeito). */
export function importantProblemsAsDefects(
  problemas: Array<{ severidade: string; arquivoLinha: string; descricao: string; req?: string }>,
  defeitos: FinalDefect[]
): FinalDefect[] {
  return problemas
    .filter((p) => p.severidade === "importante" && !defeitos.some((d) => d.defeito.includes(p.arquivoLinha)))
    .map((p) => ({
      ...(p.req ? { req: p.req } : {}),
      arquivo: fileOfRef(p.arquivoLinha),
      defeito: `revisão final [importante] ${p.arquivoLinha}: ${p.descricao}`,
      prova: "sem_prova" as const,
    }));
}

export interface DeliveryReportInput {
  reqs: string[];
  /** Vereditos da revisão final (`REQ-001=implementado`). */
  revisaoFinal?: string[];
  telas?: string[];
  ressalvas: FinalDefect[];
  perguntasSpec: string[];
}

/** Mudança 44: ao entregar, o chat diz o que foi conferido e o que ficou como ressalva (antes: nada). */
export function buildDeliveryReport(input: DeliveryReportInput): string {
  const linhas = ["✅ **Entrega concluída.**", "", "**O que foi conferido:**"];
  linhas.push(`- ${input.reqs.length} requisito(s) da Spec aprovados pelo avaliador de cada etapa; arquivos da Spec no disco; type-check do projeto sem erro.`);
  if (input.telas?.length) linhas.push(`- Telas abertas no navegador: ${input.telas.join(", ")}.`);
  if (input.revisaoFinal?.length) {
    const impl = input.revisaoFinal.filter((v) => v.endsWith("=implementado")).length;
    linhas.push(`- Revisão final do projeto inteiro: ${impl}/${input.revisaoFinal.length} REQ implementados; testes do projeto e defeitos suspeitos rodados na bancada (sem rede).`);
  }
  if (input.ressalvas.length) {
    linhas.push("", `**Ressalvas** (apontadas pela leitura, sem teste que prove — confira ao usar) — ${input.ressalvas.length}:`);
    linhas.push(...input.ressalvas.slice(0, 15).map(linhaDefeito));
  }
  if (input.perguntasSpec.length) {
    linhas.push("", "**Perguntas sobre a Spec** (o código seguiu uma das leituras; responda se quiser outra):");
    linhas.push(...input.perguntasSpec.map((q) => `- ${q}`));
  }
  return linhas.join("\n");
}

export function buildDeliveryDiagnosis(input: DeliveryDiagnosisInput): DeliveryDiagnosis {
  const provados = input.defeitos.filter((d) => d.prova === "reproduzido");
  const lidos = input.defeitos.filter((d) => d.prova !== "reproduzido" && d.prova !== "spec");
  const linhas: string[] = ["**Diagnóstico da verificação final**"];
  if (input.triagem) {
    linhas.push("", formatTriageForHumans(input.triagem));
  }
  if (provados.length) linhas.push(`\n**Defeitos de código com prova** (o teste falha) — ${provados.length}:`, ...provados.map(linhaDefeito));
  if (lidos.length) linhas.push(`\n**Defeitos de código sem teste** (pela leitura; ex.: só tela) — ${lidos.length}:`, ...lidos.map(linhaDefeito));
  if (input.perguntasSpec.length) linhas.push(`\n**Perguntas sobre a Spec** — responda aqui no chat:`, ...input.perguntasSpec.map((q) => `- ${q}`));
  if (input.outrasLacunas.length) linhas.push(`\n**Outras lacunas:**`, ...input.outrasLacunas.slice(0, 10).map((g) => `- ${g}`));
  if (input.progresso.length > 1) linhas.push(`\n**Progresso das revisões:** ${input.progresso.join(" → ")} defeito(s).`);

  // "Todos com dona" já cobre as lacunas da T10 (arquivo ausente, erro de tipo): também são código.
  const temCodigo =
    input.reparo.tipo === "esgotado" &&
    input.reparo.todosComDono === true &&
    (input.perguntasSpec.length === 0 || input.defeitos.some((d) => d.prova !== "spec"));
  // Uma pergunta de Spec não trava a rodada extra do código: ela é listada para o fundador responder.
  linhas.push(
    temCodigo && input.perguntasSpec.length === 0
      ? "\n**A Spec está certa:** o que sobrou é defeito de código, cada um com etapa dona."
      : temCodigo
        ? "\n**O código pode seguir:** mais uma rodada corrige os defeitos de código; as perguntas acima ficam para você responder quando puder."
        : input.perguntasSpec.length
          ? "\n**A Spec precisa de resposta** nas perguntas acima."
          : ""
  );
  linhas.push(`\n${input.reparo.motivo}`);
  return { evento: temCodigo ? "REPARO_ESGOTADO" : "VERIFICACAO_COM_LACUNAS", detalhe: linhas.filter(Boolean).join("\n") };
}
