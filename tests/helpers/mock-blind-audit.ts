/** Resposta mínima válida do avaliador cego pós §3.1 (AV1.3: nivelProva + fatoQueGarante). */
export type MockReqVerdict = { id: string; status: string; evidencia: string };

export function mockBlindAuditJson(
  opts: {
    reqVerdicts?: MockReqVerdict[];
    implemented?: boolean;
    justification?: string;
    fatoQueGarante?: string;
    nivelProva?: string;
    problemas?: unknown[];
  } & Record<string, unknown> = {}
): string {
  const reqVerdicts =
    opts.reqVerdicts ?? [{ id: "REQ-001", status: "implementado", evidencia: "src/lib/x.ts:1" }];
  const firstImpl = reqVerdicts.find((r) => r.status === "implementado")?.evidencia ?? "src/lib/x.ts:1";
  const fato = opts.fatoQueGarante ?? (firstImpl.includes(":") ? firstImpl : `${firstImpl}:1`);
  const { reqVerdicts: _r, fatoQueGarante: _f, ...rest } = opts;
  return JSON.stringify({
    implemented: opts.implemented ?? true,
    missingRequirements: [],
    justification: opts.justification ?? "ok",
    nivelProva: opts.nivelProva ?? "arquivo_linha",
    fatoQueGarante: fato,
    reqVerdicts,
    ...rest,
  });
}
