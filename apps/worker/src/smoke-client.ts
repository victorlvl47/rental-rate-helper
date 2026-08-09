import { Client, Connection } from '@temporalio/client';
import { randomUUID } from 'node:crypto';
import { temporalAddress, temporalTaskQueue } from './config.js';
import { smokeTestWorkflow } from './workflows/smoke-workflow.js';

async function run(): Promise<void> {
  let connection: Connection | undefined;

  try {
    console.info(`Connecting Temporal smoke client to ${temporalAddress}`);
    connection = await Connection.connect({ address: temporalAddress });

    const client = new Client({ connection });
    const workflowId = `rental-rate-helper-smoke-${randomUUID()}`;
    const handle = await client.workflow.start(smokeTestWorkflow, {
      taskQueue: temporalTaskQueue,
      workflowId,
    });
    const result = await handle.result();

    console.info(`Temporal smoke workflow ${workflowId} completed: ${result}`);
  } catch (error) {
    console.error(`Temporal smoke test could not connect to ${temporalAddress}.`);
    console.error(formatTemporalError(error));
    process.exitCode = 1;
  } finally {
    connection?.close();
  }
}

function formatTemporalError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown Temporal smoke test error.';
}

void run();
