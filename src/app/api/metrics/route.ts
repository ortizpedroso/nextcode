import { NextRequest, NextResponse } from "next/server";
import { requireReadAuth } from "@/core/security/local-auth";
import { getRouterMetrics } from "@/core/router/smart-router";
import { getQuotaStatus } from "@/core/router/quota-tracker";

/** Fase 6 — métricas do dispatcher (somente leitura, nada sensível). */
export async function GET(req: NextRequest) {
  const guard = requireReadAuth(req);
  if (guard.response) return guard.response;
  const m = getRouterMetrics();
  return NextResponse.json({
    geminiFallbacks: m.geminiFallbacks,
    exhaustedReplies: m.exhausted,
    // Fase 12 — combos em cooldown por cota esgotada (HTTP 402/429).
    quotaCooldowns: getQuotaStatus(),
    timestamp: new Date().toISOString(),
  });
}
