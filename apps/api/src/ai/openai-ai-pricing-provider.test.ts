import { describe, expect, it, vi } from 'vitest';
import type { RuleBasedPricingResult } from 'shared';

import { DEFAULT_OPENAI_PRICING_MODEL, OpenAiPricingProvider, type FetchLike } from './openai-ai-pricing-provider.js';

const ruleBasedPricing: RuleBasedPricingResult = {
  property_id: '550e8400-e29b-41d4-a716-446655440000',
  signal_count: 2,
  market_signals_used: true,
  base_price: 100.5,
  minimum_recommended_price: 99.12,
  recommended_price: 104.34,
  maximum_recommended_price: 109.56,
  adjustments: { occupancy: 0.01, demand: 0.04, competitor: 0.02, seasonality: -0.01, local_event: 0.03, total: 0.09 },
};

const validRecommendation = {
  recommended_price: 104.34,
  explanation: 'The authoritative deterministic range reflects the available market signals.',
  confidence_score: 0.8,
  risk_level: 'low',
};

function structuredResponse(value: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue({
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }],
    }),
  } as unknown as Response;
}

function provider(fetch: FetchLike): OpenAiPricingProvider {
  return new OpenAiPricingProvider({ apiKey: 'test-secret-key', fetch });
}

describe('OpenAiPricingProvider', () => {
  it('sends a strict Responses API structured-output request and returns shared-schema-validated data', async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(structuredResponse(validRecommendation));
    const result = await provider(fetch).getRecommendation(ruleBasedPricing);

    expect(result).toEqual(validRecommendation);
    expect(fetch).toHaveBeenCalledOnce();
    const [url, request] = fetch.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(request?.headers).toMatchObject({ Authorization: 'Bearer test-secret-key', 'Content-Type': 'application/json' });
    const body = JSON.parse(request?.body as string) as Record<string, any>;
    expect(body.model).toBe(DEFAULT_OPENAI_PRICING_MODEL);
    expect(body.text.format).toMatchObject({ type: 'json_schema', name: 'ai_pricing_recommendation', strict: true });
    expect(body.text.format.schema).toMatchObject({ type: 'object', additionalProperties: false });
    expect(body.text.format.schema.properties.recommended_price.enum).toEqual([ruleBasedPricing.recommended_price]);
    expect(body.input[0].content[0].text).toContain(ruleBasedPricing.property_id);
  });

  it.each([
    ['numeric-string price', { ...validRecommendation, recommended_price: '104.34' }],
    ['unknown field', { ...validRecommendation, unexpected: true }],
    ['blank explanation', { ...validRecommendation, explanation: '  ' }],
    ['invalid confidence', { ...validRecommendation, confidence_score: 1.1 }],
    ['invalid risk', { ...validRecommendation, risk_level: 'critical' }],
    ['changed authoritative price', { ...validRecommendation, recommended_price: 104.35 }],
  ])('rejects schema-invalid structured output: %s', async (_label, output) => {
    await expect(provider(vi.fn<FetchLike>().mockResolvedValue(structuredResponse(output))).getRecommendation(ruleBasedPricing)).rejects.toThrow(
      /invalid structured output|changed the authoritative recommended price/,
    );
  });

  it('fails safely for missing or malformed structured output', async () => {
    const missingOutput = { ok: true, status: 200, json: vi.fn().mockResolvedValue({ status: 'completed', output: [] }) } as unknown as Response;
    const malformedOutput = structuredResponse('{not-json');

    await expect(provider(vi.fn<FetchLike>().mockResolvedValue(missingOutput)).getRecommendation(ruleBasedPricing)).rejects.toThrow(
      'missing structured output',
    );
    await expect(provider(vi.fn<FetchLike>().mockResolvedValue(malformedOutput)).getRecommendation(ruleBasedPricing)).rejects.toThrow(
      'malformed structured output',
    );
  });

  it('fails safely for provider HTTP responses without exposing a secret or body', async () => {
    const secret = 'test-secret-that-must-not-appear';
    const response = { ok: false, status: 401, json: vi.fn().mockResolvedValue({ error: { message: secret } }) } as unknown as Response;

    try {
      await provider(vi.fn<FetchLike>().mockResolvedValue(response)).getRecommendation(ruleBasedPricing);
      throw new Error('Expected provider request to fail.');
    } catch (error) {
      expect((error as Error).message).toBe('OpenAI pricing provider returned HTTP status 401.');
      expect((error as Error).message).not.toContain(secret);
    }
  });

  it('fails safely for network and timeout errors', async () => {
    await expect(provider(vi.fn<FetchLike>().mockRejectedValue(new Error('network secret'))).getRecommendation(ruleBasedPricing)).rejects.toThrow(
      'transport failed',
    );

    const timeoutFetch: FetchLike = async (_url, request) =>
      new Promise<Response>((_resolve, reject) => request?.signal?.addEventListener('abort', () => reject(new Error('timed out'))));
    await expect(new OpenAiPricingProvider({ apiKey: 'test-secret-key', fetch: timeoutFetch, timeoutMs: 1 }).getRecommendation(ruleBasedPricing)).rejects.toThrow(
      'request timed out',
    );
  });
});
