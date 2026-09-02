import cors from '@fastify/cors';
import { checkDatabaseConnection, closeDatabase, createRecommendationWorkflowRepository, type RecommendationWorkflowRepository } from 'database';
import Fastify from 'fastify';
import {
  aiPricingPreviewResponseSchema,
  aiPricingValidationRejectionResponseSchema,
  propertySchema,
  RENTAL_MARKETS,
  rentalMarketSchema,
  calendarDateSchema,
  pricingWorkflowId,
  pricingWorkflowRequestSchema,
} from 'shared';
import type { AiPricingProvider } from './ai/ai-pricing-provider.js';
import { createAiPricingProvider } from './ai/config.js';
import { validateAiPricingRecommendation } from './ai/validate-ai-pricing-recommendation.js';
import { calculateRuleBasedPricing } from './pricing/rule-based-pricing.js';
import { createRentalDataRepository, type RentalDataRepository } from './rental-data-repository.js';
import { createPricingWorkflowClient, type PricingWorkflowClient } from './temporal/pricing-workflow-client.js';
import { temporalAddress } from './temporal/runtime-config.js';

export interface ApiDependencies {
  checkDatabaseConnection: () => Promise<void>;
  closeDatabase: () => Promise<void>;
  rentalDataRepository: RentalDataRepository;
  aiPricingProvider: AiPricingProvider;
  calculateRuleBasedPricing: typeof calculateRuleBasedPricing;
  pricingWorkflowClient: PricingWorkflowClient;
  recommendationWorkflowRepository: RecommendationWorkflowRepository;
}

interface CreateAppOptions extends Partial<ApiDependencies> {
  logger?: boolean;
}

const defaultDependencies: ApiDependencies = {
  checkDatabaseConnection,
  closeDatabase,
  rentalDataRepository: createRentalDataRepository(),
  // Resolve configuration only when the AI route is called, so a bad OpenAI
  // configuration cannot prevent unrelated routes from starting or handling requests.
  aiPricingProvider: {
    getRecommendation(ruleBasedPricing) {
      return createAiPricingProvider().getRecommendation(ruleBasedPricing);
    },
  },
  calculateRuleBasedPricing,
  pricingWorkflowClient: createPricingWorkflowClient(),
  recommendationWorkflowRepository: createRecommendationWorkflowRepository(),
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

  app.post<{ Params: { propertyId: string }; Body: { pricing_date?: unknown } }>('/properties/:propertyId/pricing-recommendations', async (request, reply) => {
    const parsed = pricingWorkflowRequestSchema.safeParse({ property_id: request.params.propertyId, pricing_date: request.body?.pricing_date });
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid property ID or pricing date.' });
    try { const started = await dependencies.pricingWorkflowClient.startOrResolve(parsed.data); return reply.code(started.started ? 202 : 200).send({ workflow_id: started.workflow_id, status: 'pending', already_started: !started.started }); } catch (error) { const code = getErrorCode(error); app.log.error({ temporalStartError: { name: getErrorName(error), ...(code ? { code } : {}), address: temporalAddress, workflow_id: pricingWorkflowId(parsed.data) } }, 'Pricing workflow start failed'); return reply.code(503).send({ error: 'Service unavailable.' }); }
  });

  app.get<{ Params: { propertyId: string }; Querystring: { pricing_date?: unknown } }>('/properties/:propertyId/pricing-recommendations/status', async (request, reply) => {
    const parsed = pricingWorkflowRequestSchema.safeParse({ property_id: request.params.propertyId, pricing_date: request.query.pricing_date });
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid property ID or pricing date.' });
    try { const status = await dependencies.recommendationWorkflowRepository.getStatus(parsed.data); return status ? status : reply.code(404).send({ error: 'Pricing request not found.' }); } catch { return reply.code(503).send({ error: 'Service unavailable.' }); }
  });

  app.get<{ Params: { propertyId: string } }>(
    '/properties/:propertyId/pricing-preview',
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

        const signals = await dependencies.rentalDataRepository.listMarketSignals(parsedPropertyId.data);

        return dependencies.calculateRuleBasedPricing(property, signals);
      } catch (error) {
        const code = getErrorCode(error);
        app.log.error(
          { databaseError: { name: getErrorName(error), ...(code ? { code } : {}) } },
          'Pricing preview query failed',
        );
        return reply.code(503).send({ error: 'Service unavailable.' });
      }
    },
  );

  app.get<{ Params: { propertyId: string } }>(
    '/properties/:propertyId/ai-pricing-preview',
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

        const signals = await dependencies.rentalDataRepository.listMarketSignals(parsedPropertyId.data);
        const ruleBasedPricing = dependencies.calculateRuleBasedPricing(property, signals);
        const aiRecommendation = await dependencies.aiPricingProvider.getRecommendation(ruleBasedPricing);
        const validation = validateAiPricingRecommendation(property, ruleBasedPricing, aiRecommendation);

        if (!validation.valid) {
          return reply.code(422).send(
            aiPricingValidationRejectionResponseSchema.parse({
              error: 'Recommendation rejected.',
              issue_codes: validation.issue_codes,
            }),
          );
        }

        return aiPricingPreviewResponseSchema.parse({
          rule_based_pricing: ruleBasedPricing,
          ai_recommendation: validation.recommendation,
        });
      } catch (error) {
        const code = getErrorCode(error);
        app.log.error(
          { aiPricingError: { name: getErrorName(error), ...(code ? { code } : {}) } },
          'AI pricing preview failed',
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
