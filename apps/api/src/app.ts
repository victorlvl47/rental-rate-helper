import cors from '@fastify/cors';
import { checkDatabaseConnection, closeDatabase } from 'database';
import Fastify from 'fastify';

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: 'http://localhost:3000',
});

app.get('/health', async (_request, reply) => {
  try {
    await checkDatabaseConnection();

    return {
      status: 'ok',
      service: 'rental-rate-helper-api',
      database: 'connected',
    };
  } catch (error) {
    const code = getErrorCode(error);

    app.log.error(
      { databaseError: { name: getErrorName(error), ...(code ? { code } : {}) } },
      'Database health check failed',
    );

    return reply.code(503).send({
      status: 'unhealthy',
      service: 'rental-rate-helper-api',
      database: 'disconnected',
    });
  }
});

app.addHook('onClose', async () => {
  await closeDatabase();
});

function getErrorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}

function getErrorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const { code } = error;
    return typeof code === 'string' ? code : undefined;
  }

  return undefined;
}

export default app;
