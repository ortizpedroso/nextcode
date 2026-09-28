import { NextResponse } from "next/server";
import { getRouterMetrics } from "@/core/router/smart-router";

/** Fase 6 — métricas do dispatcher (somente leitura, nada sensível). */
export async function GET() {
  const m = getRouterMetrics();
  const successRate = m.omnirouteAttempts ? m.omnirouteSuccesses / m.omnirouteAttempts : null;
  return NextResponse.json({
    omniroute: {
      attempts: m.omnirouteAttempts,
      successes: m.omnirouteSuccesses,
      successRate,
      latencyP50Ms: m.p50 ?? null,
      latencyP95Ms: m.p95 ?? null,
    },
    geminiFallbacks: m.geminiFallbacks,
    exhaustedReplies: m.exhausted,
    timestamp: new Date().toISOString(),
  });
}
