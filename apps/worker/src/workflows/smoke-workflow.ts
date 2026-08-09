import { proxyActivities } from '@temporalio/workflow';
import type * as activities from '../activities/smoke-activity.js';

const { completeSmokeTest } = proxyActivities<typeof activities>({
  startToCloseTimeout: '1 minute',
});

export async function smokeTestWorkflow(): Promise<string> {
  return completeSmokeTest();
}
