import { Worker } from "@temporalio/worker";
import * as activities from "./activities.js";

async function runWorker() {
  console.log("[TEMPORAL WORKER] 🚀 Initializing Trailhead Promise Worker...");

  const worker = await Worker.create({
    workflowsPath: new URL("./workflows.js", import.meta.url).pathname,
    activities,
    taskQueue: "trailhead-safety-queue",
  });

  console.log("[TEMPORAL WORKER] 🟢 Worker listening on task queue: trailhead-safety-queue");
  await worker.run();
}

runWorker().catch((err) => {
  console.error("[TEMPORAL WORKER] ❌ Fatal error running worker:", err);
  process.exit(1);
});
