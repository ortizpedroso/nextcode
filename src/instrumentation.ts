function devWorkerDelayMs(): number {
  const raw = Number(process.env.NEXTCODE_WORKER_DEV_DELAY_MS);
  if (Number.isFinite(raw) && raw >= 0) return Math.floor(raw);
  return 2_000;
}

/** Dev não bloqueia `register()` no grafo do job-worker (compilação pesada antes do Ready). */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXTCODE_WORKER_DISABLED === "1") {
    return;
  }

  const bootWorker = () =>
    import("@/core/orchestrator/job-worker").then(({ startJobWorker }) => startJobWorker());

  if (process.env.NODE_ENV === "development") {
    const delayMs = devWorkerDelayMs();
    setTimeout(() => void bootWorker(), delayMs);
    return;
  }

  await bootWorker();
}
