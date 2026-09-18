import { Client, Connection, WorkflowExecutionAlreadyStartedError } from '@temporalio/client';
import { WorkflowIdConflictPolicy, WorkflowIdReusePolicy } from '@temporalio/common';
import { pricingWorkflowId, type PricingWorkflowRequest } from 'shared';
import { temporalAddress, temporalTaskQueue } from './runtime-config.js';

export interface PricingWorkflowClient { startOrResolve(request: PricingWorkflowRequest): Promise<{ workflow_id: string; started: boolean }>; }

type TemporalWorkflowStarter = Pick<Client, 'workflow'>;

export interface PricingWorkflowClientDependencies {
  connect: typeof Connection.connect;
  createClient(connection: Connection): TemporalWorkflowStarter;
}

const defaultDependencies: PricingWorkflowClientDependencies = {
  // Keep Connection as the receiver: its static connect() calls this.lazy().
  connect: (options) => Connection.connect(options),
  createClient: (connection) => new Client({ connection }),
};

export function createPricingWorkflowClient(dependencyOverrides: Partial<PricingWorkflowClientDependencies> = {}): PricingWorkflowClient {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides };

  return {
    async startOrResolve(request) {
      const workflow_id = pricingWorkflowId(request);
      let connection: Connection | undefined;

      try {
        connection = await dependencies.connect({ address: temporalAddress });
        const client = dependencies.createClient(connection);
        await client.workflow.start('GeneratePricingRecommendationWorkflow', {
          taskQueue: temporalTaskQueue,
          workflowId: workflow_id,
          args: [request],
          // Reject both an active run and every closed execution with this ID.
          workflowIdConflictPolicy: WorkflowIdConflictPolicy.FAIL,
          workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
        });
        return { workflow_id, started: true };
      } catch (error) {
        if (error instanceof WorkflowExecutionAlreadyStartedError) {
          return { workflow_id, started: false };
        }
        throw error;
      } finally {
        await connection?.close();
      }
    },
  };
}
