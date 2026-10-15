import { askJevBatch, type JevQuestionSpec } from "@/core/decision/jev";
import { TelemetryLogger } from "@/core/telemetry/telemetry-logger";

export type SecretGuardMode = "ativo" | "desligado";

export interface SecretCandidate {
  arquivo: string;
  linha: number;
  trecho: string;
  valorSegredo: string;
}

export interface SecretGuardCandidateEvaluation {
  arquivo: string;
  linha: number;
  noul: number | null;
  bloqueado: boolean;
}

export interface SecretGuardCodeResult {
  blocked: boolean;
  candidatos: SecretGuardCandidateEvaluation[];
  rejectionReasons: string[];
}

export interface SecretGuardChatResult {
  redactedText: string;
  redactedCount: number;
  candidatos: SecretGuardCandidateEvaluation[];
}

const PREFIX_KEY_RE =
  /(?<![A-Za-z0-9_-])(?:sk_live_[A-Za-z0-9_\-]{6,}|pk_live_[A-Za-z0-9_\-]{6,}|sk-[A-Za-z0-9_\-]{10,}|ghp_[A-Za-z0-9_]{8,}|gho_[A-Za-z0-9_]{8,}|AKIA[0-9A-Z]{12,}|AIza[0-9A-Za-z_\-]{12,}|xox[bpa]-[0-9A-Za-z\-]{8,})(?![A-Za-z0-9_])/g;

const PRIVATE_KEY_BLOCK_RE =
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----(?:[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----)?/g;

const ASSIGNMENT_SECRET_RE =
  /\b([A-Za-z0-9_]*(?:key|secret|token|password|senha|apikey)[A-Za-z0-9_]*)\s*(?:[:=])\s*(["'`])([^"'`\r\n]{16,})\2/gi;

export function shannonEntropy(str: string): number {
  if (!str || str.length === 0) return 0;
  const freq = new Map<string, number>();
  for (const ch of str) {
    freq.set(ch, (freq.get(ch) ?? 0) + 1);
  }
  let entropy = 0;
  const len = str.length;
  for (const count of freq.values()) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

export function isPlaceholderValue(value: string, surroundingLine = ""): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (/^<[^>]+>$/.test(trimmed) || /<[^>]+>/.test(trimmed)) return true;
  if (
    /your[-_]?key|your[-_]?secret|your[-_]?token|changeme|example|placeholder|dummy|^x+$|(?:\b|_|-)(?:xxx+)(?:\b|_|-)/i.test(
      trimmed
    )
  ) {
    return true;
  }
  if (/process\.env\b/.test(trimmed)) return true;
  if (surroundingLine && /process\.env\.[A-Za-z0-9_]+/.test(surroundingLine) && !surroundingLine.includes(trimmed)) {
    return true;
  }
  return false;
}

export function isHighEntropySecretLiteral(value: string): boolean {
  if (value.length < 16) return false;
  if (/\s/.test(value)) return false;
  if (/^(?:https?:\/\/|\.?\.?\/|@[a-z0-9])/i.test(value)) return false;
  if (isPlaceholderValue(value)) return false;

  let classes = 0;
  if (/[a-z]/.test(value)) classes += 1;
  if (/[A-Z]/.test(value)) classes += 1;
  if (/[0-9]/.test(value)) classes += 1;
  if (/[^a-zA-Z0-9]/.test(value)) classes += 1;
  if (classes < 2) return false;

  return shannonEntropy(value) >= 3.2;
}

const KNOWN_SECRET_PREFIX_RE = /^(?:sk_live_|pk_live_|sk-|ghp_|gho_|AKIA|AIza|xox[bpa]-|-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----)/;

/**
 * Descreve o valor sem revelá-lo: o Jev é um serviço externo e nenhum segredo pode sair da máquina
 * (ARQUITETURA §14.4). Mantém só o prefixo público do formato (ex.: `sk_live_`), o tamanho e a entropia.
 */
export function describeSecretShape(valor: string): string {
  const prefix = valor.match(KNOWN_SECRET_PREFIX_RE)?.[0] ?? "";
  return `${prefix}«valor oculto: ${valor.length} caracteres, entropia ${shannonEntropy(valor).toFixed(1)}»`;
}

/** Trecho da linha com o valor trocado pela descrição do formato — é o único texto que vai ao Jev. */
export function maskSecretInExcerpt(trecho: string, valor: string): string {
  const shape = describeSecretShape(valor);
  let masked = trecho.split(valor).join(shape);
  // O trecho pode ter sido cortado no meio do valor; nesse caso, nada depois do início do valor sai.
  const head = valor.slice(0, 8);
  const cut = head ? masked.indexOf(head) : -1;
  if (cut >= 0 && !masked.includes(shape)) masked = masked.slice(0, cut) + shape;
  return masked;
}

export function findSecretCandidatesInText(
  arquivo: string,
  content: string
): SecretCandidate[] {
  const normFile = arquivo.replace(/\\/g, "/").trim();
  if (/(?:^|\/)\.env\.example$/i.test(normFile)) {
    return [];
  }

  const candidates: SecretCandidate[] = [];
  const seenKey = new Set<string>();

  const addCandidate = (linha: number, trecho: string, valorSegredo: string) => {
    const dedup = `${normFile}:${linha}:${valorSegredo}`;
    if (seenKey.has(dedup)) return;
    seenKey.add(dedup);
    candidates.push({
      arquivo: normFile,
      linha,
      trecho: trecho.slice(0, 300),
      valorSegredo,
    });
  };

  // 1) Blocos/cabeçalhos de chave privada PEM
  for (const m of content.matchAll(PRIVATE_KEY_BLOCK_RE)) {
    const matched = m[0];
    const index = m.index ?? 0;
    const linha = content.slice(0, index).split(/\r?\n/).length;
    const firstLine = matched.split(/\r?\n/)[0] || matched;
    addCandidate(linha, firstLine.trim(), matched);
  }

  // 2) Varredura por linha para prefixos conhecidos e atribuições de alta entropia
  const lines = content.split(/\r?\n/);
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    const lineNumber = idx + 1;

    if (/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(line)) {
      continue;
    }

    for (const pm of line.matchAll(PREFIX_KEY_RE)) {
      const token = pm[0];
      const matchIdx = pm.index ?? 0;
      const beforeChar = matchIdx > 0 ? line[matchIdx - 1] : "";
      const afterChar = line[matchIdx + token.length] ?? "";
      if (beforeChar === "<" && afterChar === ">") continue;
      if (isPlaceholderValue(token, line)) continue;
      addCandidate(lineNumber, line.trim(), token);
    }

    for (const am of line.matchAll(ASSIGNMENT_SECRET_RE)) {
      const literal = am[3];
      if (isPlaceholderValue(literal, line)) continue;
      if (!isHighEntropySecretLiteral(literal)) continue;
      addCandidate(lineNumber, line.trim(), literal);
    }
  }

  return candidates;
}

export function findSecretCandidatesInFiles(
  codeContentMap: Record<string, string>
): SecretCandidate[] {
  const all: SecretCandidate[] = [];
  for (const [filePath, content] of Object.entries(codeContentMap)) {
    all.push(...findSecretCandidatesInText(filePath, content));
  }
  return all;
}

async function evaluateCandidatesWithJev(params: {
  sessionId?: string | null;
  purpose: string;
  candidatos: SecretCandidate[];
  limiarSegredoNoul: number;
}): Promise<Array<{ candidate: SecretCandidate; noul: number | null; bloqueado: boolean }>> {
  const stateObj = {
    candidatos: params.candidatos.map((c) => ({
      arquivo: c.arquivo,
      linha: c.linha,
      trecho: maskSecretInExcerpt(c.trecho, c.valorSegredo),
    })),
  };
  const questions: Record<string, JevQuestionSpec> = {};
  params.candidatos.forEach((_, i) => {
    questions[`q_${i}`] = {
      type: "noul",
      instructions: `In \`candidatos[${i}].trecho\` the literal value was replaced by «valor oculto: N caracteres, entropia E», keeping only its public format prefix. Judging from the variable name, the prefix, the length and the entropy, is this a real credential or secret value hardcoded in source code (not a placeholder, example or environment variable reference)?`,
    };
  });

  const answers = await askJevBatch({
    purpose: params.purpose,
    state: JSON.stringify(stateObj),
    questions,
    sessionId: params.sessionId,
    maxStateChars: 24000,
  });

  return params.candidatos.map((candidate, i) => {
    const ans = answers?.[`q_${i}`];
    if (!ans || ans.type !== "noul" || typeof ans.noul !== "number") {
      // Fail-closed: Jev indisponível (null) com candidato do regex reprova/oculta igual
      return { candidate, noul: null, bloqueado: true };
    }
    return {
      candidate,
      noul: ans.noul,
      bloqueado: ans.noul >= params.limiarSegredoNoul,
    };
  });
}

export async function checkSecretsInCodeWithJev(params: {
  sessionId?: string | null;
  nodeId: string;
  codeContentMap: Record<string, string>;
  modo: SecretGuardMode;
  limiarSegredoNoul: number;
}): Promise<SecretGuardCodeResult> {
  if (params.modo === "desligado") {
    return { blocked: false, candidatos: [], rejectionReasons: [] };
  }

  const rawCandidates = findSecretCandidatesInFiles(params.codeContentMap);
  if (rawCandidates.length === 0) {
    return { blocked: false, candidatos: [], rejectionReasons: [] };
  }

  const evaluated = await evaluateCandidatesWithJev({
    sessionId: params.sessionId,
    purpose: "secret_guard",
    candidatos: rawCandidates,
    limiarSegredoNoul: params.limiarSegredoNoul,
  });

  const candidatos: SecretGuardCandidateEvaluation[] = [];
  const rejectionReasons: string[] = [];

  for (const item of evaluated) {
    candidatos.push({
      arquivo: item.candidate.arquivo,
      linha: item.candidate.linha,
      noul: item.noul,
      bloqueado: item.bloqueado,
    });

    TelemetryLogger.log({
      sessionId: params.sessionId ?? undefined,
      action: "SECRET_GUARD",
      details: {
        nodeId: params.nodeId,
        arquivo: item.candidate.arquivo,
        linha: item.candidate.linha,
        noul: item.noul,
        bloqueado: item.bloqueado,
        modo: params.modo,
      },
    });

    if (item.bloqueado) {
      rejectionReasons.push(
        `[SECRET IN CODE] ${item.candidate.arquivo}:${item.candidate.linha} — use variável de ambiente`
      );
    }
  }

  return {
    blocked: rejectionReasons.length > 0,
    candidatos,
    rejectionReasons,
  };
}

export async function redactSecretsInChatWithJev(params: {
  sessionId?: string | null;
  text: string;
  modo: SecretGuardMode;
  limiarSegredoNoul: number;
}): Promise<SecretGuardChatResult> {
  if (params.modo === "desligado" || !params.text) {
    return { redactedText: params.text, redactedCount: 0, candidatos: [] };
  }

  const rawCandidates = findSecretCandidatesInText("chat_response", params.text);
  if (rawCandidates.length === 0) {
    return { redactedText: params.text, redactedCount: 0, candidatos: [] };
  }

  const evaluated = await evaluateCandidatesWithJev({
    sessionId: params.sessionId,
    purpose: "secret_guard_chat",
    candidatos: rawCandidates,
    limiarSegredoNoul: params.limiarSegredoNoul,
  });

  let redactedText = params.text;
  let redactedCount = 0;
  const candidatos: SecretGuardCandidateEvaluation[] = [];

  for (const item of evaluated) {
    candidatos.push({
      arquivo: item.candidate.arquivo,
      linha: item.candidate.linha,
      noul: item.noul,
      bloqueado: item.bloqueado,
    });

    TelemetryLogger.log({
      sessionId: params.sessionId ?? undefined,
      action: "SECRET_GUARD_CHAT",
      details: {
        linha: item.candidate.linha,
        noul: item.noul,
        bloqueado: item.bloqueado,
        modo: params.modo,
      },
    });

    if (item.bloqueado && item.candidate.valorSegredo) {
      if (redactedText.includes(item.candidate.valorSegredo)) {
        redactedText = redactedText.split(item.candidate.valorSegredo).join("[SEGREDO OCULTADO]");
        redactedCount += 1;
      }
    }
  }

  return {
    redactedText,
    redactedCount,
    candidatos,
  };
}

/**
 * Mascara segredos antes do envio ao Jev (Regra 7 de segurança).
 * Troca todas as ocorrências de cada valor de segredo identificado pela descrição de describeSecretShape.
 */
export function maskSecretsForJev(text: string): { text: string; count: number } {
  const candidates = findSecretCandidatesInText("jev_state", text);
  let masked = text;
  const uniqueSecrets = new Set<string>();
  for (const c of candidates) {
    if (c.valorSegredo) {
      uniqueSecrets.add(c.valorSegredo);
    }
  }
  for (const valor of uniqueSecrets) {
    const shape = describeSecretShape(valor);
    masked = masked.split(valor).join(shape);
  }
  return {
    text: masked,
    count: uniqueSecrets.size,
  };
}
