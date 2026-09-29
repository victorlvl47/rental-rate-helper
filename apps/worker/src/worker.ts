import { NativeConnection, Worker } from '@temporalio/worker';
import { fileURLToPath } from 'node:url';
import * as smokeActivities from './activities/smoke-activity.js';
import * as pricingActivities from './activities/pricing-recommendation-activity.js';
import { temporalAddress, temporalTaskQueue } from './config.js';
import { initializeSentry, captureUnexpected } from './observability/sentry.js';

const workflowPath = fileURLToPath(
  new URL(
    import.meta.url.endsWith('.ts')
      ? './workflows/index.ts'
      : './workflows/index.js',
    import.meta.url,
  ),
);

async function run(): Promise<void> {
  initializeSentry('worker');
  let worker: Worker | undefined;
  let connection: NativeConnection | undefined;

  function shutdown(signal: NodeJS.Signals): void {
    console.info(JSON.stringify({ level: 'info', service: 'worker', component: 'temporal', event: 'worker_shutdown_requested', signal }));
    worker?.shutdown();
  }

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  try {
    console.info(JSON.stringify({ level: 'info', service: 'worker', component: 'temporal', event: 'temporal_connecting' }));
    connection = await NativeConnection.connect({ address: temporalAddress });

    worker = await Worker.create({
      activities: { ...smokeActivities, ...pricingActivities },
      connection,
      taskQueue: temporalTaskQueue,
      workflowsPath: workflowPath,
    });

    console.info(JSON.stringify({ level: 'info', service: 'worker', component: 'temporal', event: 'temporal_worker_polling' }));
    await worker.run();
  } catch (error) {
    captureUnexpected(error, { service: "worker", component: "temporal", event: "temporal_connection_failed" });
    console.error(JSON.stringify({ level: "error", service: "worker", component: "temporal", event: "temporal_connection_failed" }));
    process.exitCode = 1;
  } finally {
    await connection?.close();
  }
}

function formatTemporalError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown Temporal worker error.';
}

void run();
