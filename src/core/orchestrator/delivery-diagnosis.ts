import type { FinalDefect } from "@/core/governance/final-reviewer";

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
}

export interface DeliveryDiagnosis {
  evento: "REPARO_ESGOTADO" | "VERIFICACAO_COM_LACUNAS";
  detalhe: string;
}

const firstLine = (s?: string) => (s ?? "").split("\n").find((l) => l.trim())?.trim().slice(0, 220) ?? "";

function linhaDefeito(d: FinalDefect): string {
  const onde = d.arquivo ? `\`${d.arquivo}\`` : "(sem arquivo)";
  const req = d.req ? `${d.req} · ` : "";
  if (d.prova === "reproduzido" && d.teste) {
    return `- ${req}${onde} · teste \`${d.teste.caminho}\` falha: ${firstLine(d.saida)}`;
  }
  return `- ${req}${onde} · ${d.defeito.replace(/^revisão final:\s*/, "").slice(0, 220)}`;
}

export function buildDeliveryDiagnosis(input: DeliveryDiagnosisInput): DeliveryDiagnosis {
  const provados = input.defeitos.filter((d) => d.prova === "reproduzido");
  const lidos = input.defeitos.filter((d) => d.prova !== "reproduzido" && d.prova !== "spec");
  const linhas: string[] = ["**Diagnóstico da verificação final**"];
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
