import { NextRequest, NextResponse } from "next/server";
import { maskKeyPresence, requireAuth, requireReadAuth } from "@/core/security/local-auth";
import prisma from "@/lib/prisma";
import { readSecret, writeSecret } from "@/core/security/crypto";
import { GATEWAY_DEFAULTS, GATEWAY_IDS, saveGatewayConfig, type GatewayId } from "@/core/llm/gateways";

function chaveNova(apiKey: string | null | undefined): string | null | undefined {
  if (apiKey === undefined) return undefined;
  if (apiKey === null) return null;
  const texto = apiKey.trim();
  if (!texto) return null;
  if (/^[•*]+$/.test(texto)) return undefined;
  return texto;
}

/** Configuração dos gateways LLM (chaves mascaradas). */
export async function GET(request: Request) {
  const guard = requireReadAuth(request);
  if (guard.response) return guard.response;

  const [rows, setting] = await Promise.all([
    prisma.llmGateway.findMany(),
    prisma.setting.findUnique({ where: { id: "default" } }),
  ]);
  const byId = new Map(rows.map((r) => [r.id, r]));

  const gateways = GATEWAY_IDS.map((id) => {
    const row = byId.get(id);
    const def = GATEWAY_DEFAULTS[id];
    // A chave da DeepSeek mora em Setting.deepseekKey (a mesma que o roteador lê).
    const key =
      id === "deepseek"
        ? readSecret((setting as { deepseekKey?: string | null } | null)?.deepseekKey)
        : readSecret(row?.apiKey);
    return {
      id,
      label: def.label,
      dashboardUrl: def.dashboardUrl,
      enabled: row?.enabled ?? true,
      priority: row?.priority ?? def.priority,
      baseUrl: row?.baseUrl || def.baseUrl,
      hasKey: Boolean(key),
      maskedKey: maskKeyPresence(key),
      modelFast: row?.modelFast ?? def.modelFast,
      modelHeavy: row?.modelHeavy ?? def.modelHeavy,
      defaultModelFast: def.modelFast,
      defaultModelHeavy: def.modelHeavy,
    };
  }).sort((a, b) => a.priority - b.priority);

  return NextResponse.json({ gateways });
}

interface GatewayPayload {
  id: GatewayId;
  enabled?: boolean;
  priority?: number;
  baseUrl?: string | null;
  apiKey?: string | null;
  modelFast?: string | null;
  modelHeavy?: string | null;
}

/**
 * Salva um ou mais gateways. apiKey omitida mantém a atual; "" apaga.
 */
export async function POST(request: NextRequest) {
  const guard = requireAuth(request);
  if (guard.response) return guard.response;

  const body = await request.json().catch(() => null);
  const items: GatewayPayload[] = Array.isArray(body?.gateways) ? body.gateways : body?.id ? [body] : [];
  if (items.length === 0) {
    return NextResponse.json({ error: "Informe { id, ... } ou { gateways: [...] }." }, { status: 400 });
  }

  for (const item of items) {
    if (!GATEWAY_IDS.includes(item.id)) {
      return NextResponse.json({ error: `Gateway desconhecido: ${item.id}` }, { status: 400 });
    }
    if (item.baseUrl) {
      try {
        new URL(item.baseUrl);
      } catch {
        return NextResponse.json({ error: `URL inválida para ${item.id}: ${item.baseUrl}` }, { status: 400 });
      }
    }
  }

  for (const item of items) {
    if (item.id === "deepseek") {
      // Mesma fonte que o roteador e a aba de chaves nativas: Setting.deepseekKey (criptografada).
      const deepseekInformada = chaveNova(item.apiKey);
      if (deepseekInformada !== undefined) {
        const deepseekKey = deepseekInformada ? writeSecret(deepseekInformada) : null;
        await prisma.setting.upsert({
          where: { id: "default" },
          update: { deepseekKey },
          create: { id: "default", deepseekKey },
        });
      }
      await saveGatewayConfig("deepseek", {
        enabled: item.enabled,
        priority: item.priority,
        baseUrl: item.baseUrl,
        modelFast: item.modelFast,
        modelHeavy: item.modelHeavy,
      });
    } else {
      await saveGatewayConfig(item.id, {
        enabled: item.enabled,
        priority: item.priority,
        baseUrl: item.baseUrl,
        apiKey: chaveNova(item.apiKey),
        modelFast: item.modelFast,
        modelHeavy: item.modelHeavy,
      });
    }
  }

  return NextResponse.json({ success: true });
}
