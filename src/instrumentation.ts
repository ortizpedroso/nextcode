export async function register(): Promise<void> {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NEXTCODE_WORKER_DISABLED !== "1"
  ) {
    const { startJobWorker } = await import("@/core/orchestrator/job-worker");
    startJobWorker();
  }
}
