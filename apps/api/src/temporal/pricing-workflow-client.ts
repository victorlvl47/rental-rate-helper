import { Client, Connection } from '@temporalio/client';
import { WorkflowIdConflictPolicy } from '@temporalio/common';
import { pricingWorkflowId, type PricingWorkflowRequest } from 'shared';
import { temporalAddress, temporalTaskQueue } from './runtime-config.js';

export interface PricingWorkflowClient { startOrResolve(request: PricingWorkflowRequest): Promise<{ workflow_id: string; started: boolean }>; }
export function createPricingWorkflowClient(): PricingWorkflowClient { return { async startOrResolve(request) { const workflow_id = pricingWorkflowId(request); let connection: Connection | undefined; try { connection = await Connection.connect({ address: temporalAddress }); const client = new Client({ connection }); await client.workflow.start('GeneratePricingRecommendationWorkflow', { taskQueue: temporalTaskQueue, workflowId: workflow_id, args: [request], workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING }); return { workflow_id, started: true }; } catch (error) { const message = error instanceof Error ? error.message : ''; if (message.includes('already exists')) return { workflow_id, started: false }; throw error; } finally { await connection?.close(); } } }; }
