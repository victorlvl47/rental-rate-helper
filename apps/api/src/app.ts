import cors from '@fastify/cors';
import { checkDatabaseConnection, closeDatabase } from 'database';
import Fastify from 'fastify';
import { propertySchema, RENTAL_MARKETS, rentalMarketSchema } from 'shared';
import { createRentalDataRepository, type RentalDataRepository } from './rental-data-repository.js';

export interface ApiDependencies {
  checkDatabaseConnection: () => Promise<void>;
  closeDatabase: () => Promise<void>;
  rentalDataRepository: RentalDataRepository;
}

interface CreateAppOptions extends Partial<ApiDependencies> {
  logger?: boolean;
}

const defaultDependencies: ApiDependencies = {
  checkDatabaseConnection,
  closeDatabase,
  rentalDataRepository: createRentalDataRepository(),
};

export function createApp(options: CreateAppOptions = {}) {
  const dependencies = { ...defaultDependencies, ...options };
  const app = Fastify({ logger: options.logger ?? true });

  app.register(cors, {
    origin: 'http://localhost:3000',
  });

  app.get('/health', async (_request, reply) => {
    try {
      await dependencies.checkDatabaseConnection();

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

  app.get('/markets', async () => RENTAL_MARKETS);

  app.get<{ Querystring: { city?: unknown } }>('/properties', async (request, reply) => {
    const parsedCity = rentalMarketSchema.safeParse(request.query.city);

    if (!parsedCity.success) {
      return reply.code(400).send({ error: 'Invalid city.' });
    }

    try {
      return await dependencies.rentalDataRepository.listProperties(parsedCity.data);
    } catch (error) {
      const code = getErrorCode(error);
      app.log.error(
        { databaseError: { name: getErrorName(error), ...(code ? { code } : {}) } },
        'Property query failed',
      );
      return reply.code(503).send({ error: 'Service unavailable.' });
    }
  });

  app.get<{ Params: { propertyId: string } }>(
    '/properties/:propertyId/market-signals',
    async (request, reply) => {
      const parsedPropertyId = propertyIdSchema.safeParse(request.params.propertyId);

      if (!parsedPropertyId.success) {
        return reply.code(400).send({ error: 'Invalid property ID.' });
      }

      try {
        const property = await dependencies.rentalDataRepository.findPropertyById(parsedPropertyId.data);

        if (property === undefined) {
          return reply.code(404).send({ error: 'Property not found.' });
        }

        return await dependencies.rentalDataRepository.listMarketSignals(parsedPropertyId.data);
      } catch (error) {
        const code = getErrorCode(error);
        app.log.error(
          { databaseError: { name: getErrorName(error), ...(code ? { code } : {}) } },
          'Market signal query failed',
        );
        return reply.code(503).send({ error: 'Service unavailable.' });
      }
    },
  );

  app.addHook('onClose', async () => {
    await dependencies.closeDatabase();
  });

  return app;
}

const propertyIdSchema = propertySchema.shape.id;

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

const app = createApp();

export default app;
