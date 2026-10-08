import { maskSecret, readSecret, writeSecret } from "@/core/security/crypto";

function parseJsonObjectOrNull(raw?: string | null): Record<string, unknown> | null {
  if (!raw || typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function encryptMcpEnv(input: unknown, stored?: string | null): string {
  if (input === undefined || input === null || input === "") {
    return "{}";
  }

  let parsed: unknown;
  if (typeof input === "string") {
    try {
      parsed = JSON.parse(input);
    } catch {
      throw new Error("env deve ser um objeto JSON");
    }
  } else {
    parsed = input;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("env deve ser um objeto JSON");
  }

  const storedObj = parseJsonObjectOrNull(stored) ?? {};
  const out: Record<string, string> = {};

  for (const [key, rawVal] of Object.entries(parsed as Record<string, unknown>)) {
    if (rawVal === undefined || rawVal === null) continue;
    const strVal = String(rawVal).trim();
    if (!strVal) continue;

    if (
      strVal.startsWith("****") &&
      Object.prototype.hasOwnProperty.call(storedObj, key) &&
      typeof storedObj[key] === "string" &&
      (storedObj[key] as string).trim()
    ) {
      out[key] = storedObj[key] as string;
    } else {
      const encrypted = writeSecret(strVal);
      if (encrypted) {
        out[key] = encrypted;
      }
    }
  }

  return JSON.stringify(out);
}

export function maskMcpEnv(stored?: string | null): string {
  const obj = parseJsonObjectOrNull(stored);
  if (!obj) return "{}";

  const out: Record<string, string> = {};
  for (const [key, rawVal] of Object.entries(obj)) {
    out[key] = maskSecret(rawVal == null ? "" : String(rawVal));
  }
  return JSON.stringify(out);
}

export function readMcpEnv(stored?: string | null): Record<string, string> {
  const obj = parseJsonObjectOrNull(stored);
  if (!obj) return {};

  const out: Record<string, string> = {};
  for (const [key, rawVal] of Object.entries(obj)) {
    out[key] = readSecret(rawVal == null ? "" : String(rawVal));
  }
  return out;
}
