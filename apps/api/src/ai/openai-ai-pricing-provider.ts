import { aiPricingRecommendationSchema, type AiPricingRecommendation, type RuleBasedPricingResult } from 'shared';

import type { AiPricingProvider } from './ai-pricing-provider.js';
import { buildPricingPrompt } from './pricing-prompt.js';

export const DEFAULT_OPENAI_PRICING_MODEL = 'gpt-5.6';
export const DEFAULT_OPENAI_PRICING_TIMEOUT_MS = 15_000;

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface OpenAiPricingProviderOptions {
  apiKey: string;
  model?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}

const aiPricingResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['recommended_price', 'explanation', 'confidence_score', 'risk_level'],
  properties: {
    recommended_price: { type: 'number', minimum: 0 },
    explanation: { type: 'string', minLength: 1 },
    confidence_score: { type: 'number', minimum: 0, maximum: 1 },
    risk_level: { type: 'string', enum: ['low', 'medium', 'high'] },
  },
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getStructuredOutputText(payload: unknown): string {
  if (!isRecord(payload) || payload.status !== 'completed' || !Array.isArray(payload.output)) {
    throw new Error('OpenAI pricing provider returned an invalid structured response.');
  }

  for (const outputItem of payload.output) {
    if (!isRecord(outputItem) || outputItem.type !== 'message' || !Array.isArray(outputItem.content)) {
      continue;
    }

    for (const content of outputItem.content) {
      if (isRecord(content) && content.type === 'output_text' && typeof content.text === 'string') {
        return content.text;
      }
    }
  }

  throw new Error('OpenAI pricing provider response is missing structured output.');
}

function parseJsonObject(text: string): unknown {
  try {
    const value: unknown = JSON.parse(text);

    if (!isRecord(value)) {
      throw new Error('not an object');
    }

    return value;
  } catch {
    throw new Error('OpenAI pricing provider returned malformed structured output.');
  }
}

export class OpenAiPricingProvider implements AiPricingProvider {
  private readonly model: string;
  private readonly fetch: FetchLike;
  private readonly timeoutMs: number;

  constructor(private readonly options: OpenAiPricingProviderOptions) {
    this.model = options.model ?? DEFAULT_OPENAI_PRICING_MODEL;
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_OPENAI_PRICING_TIMEOUT_MS;
  }

  async getRecommendation(ruleBasedPricing: RuleBasedPricingResult): Promise<AiPricingRecommendation> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      let response: Response;

      try {
        response = await this.fetch('https://api.openai.com/v1/responses', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.options.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: this.model,
            store: false,
            input: [
              {
                role: 'user',
                content: [{ type: 'input_text', text: buildPricingPrompt(ruleBasedPricing) }],
              },
            ],
            text: {
              format: {
                type: 'json_schema',
                name: 'ai_pricing_recommendation',
                strict: true,
                schema: {
                  ...aiPricingResponseSchema,
                  properties: {
                    ...aiPricingResponseSchema.properties,
                    recommended_price: {
                      ...aiPricingResponseSchema.properties.recommended_price,
                      enum: [ruleBasedPricing.recommended_price],
                    },
                  },
                },
              },
            },
          }),
          signal: controller.signal,
        });
      } catch {
        if (controller.signal.aborted) {
          throw new Error('OpenAI pricing provider request timed out.');
        }

        throw new Error('OpenAI pricing provider transport failed.');
      }

      if (!response.ok) {
        throw new Error(`OpenAI pricing provider returned HTTP status ${response.status}.`);
      }

      let payload: unknown;
      try {
        payload = (await response.json()) as unknown;
      } catch {
        throw new Error('OpenAI pricing provider returned an unreadable response.');
      }

      const result = aiPricingRecommendationSchema.safeParse(parseJsonObject(getStructuredOutputText(payload)));
      if (!result.success) {
        throw new Error('OpenAI pricing provider returned invalid structured output.');
      }

      if (result.data.recommended_price !== ruleBasedPricing.recommended_price) {
        throw new Error('OpenAI pricing provider changed the authoritative recommended price.');
      }

      return result.data;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createOpenAiPricingProvider(options: OpenAiPricingProviderOptions): AiPricingProvider {
  return new OpenAiPricingProvider(options);
}
