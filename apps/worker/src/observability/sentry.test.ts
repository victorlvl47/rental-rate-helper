import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureUnexpected, initializeSentry, isSentryEnabled, sanitizeSentryEvent } from './sentry.js';

afterEach(() => { vi.unstubAllEnvs(); });

describe('safe worker Sentry reporting', () => {
  it('is disabled without a DSN', () => {
    vi.stubEnv('SENTRY_DSN', '');
    expect(initializeSentry('worker')).toBe(false);
    expect(isSentryEnabled()).toBe(false);
  });

  it('enables only with a DSN', () => {
    vi.stubEnv('SENTRY_DSN', 'https://public.invalid/1');
    expect(initializeSentry('worker')).toBe(true);
    expect(isSentryEnabled()).toBe(true);
    captureUnexpected(new Error('postgres://user:password/token'), { service: 'worker', event: 'database_failed', secret: 'nope' });
  });

  it('removes raw errors, payloads, headers, secrets, and unapproved tags', () => {
    const event = sanitizeSentryEvent({ type: undefined, message: 'Bearer secret-token', exception: { values: [{ value: 'postgres://user:password@host/database' }] }, request: { headers: { authorization: 'Bearer secret-token' }, data: 'prompt and provider payload' }, extra: { token: 'secret-token' }, contexts: { response: { body: 'provider payload' } }, breadcrumbs: [], user: { id: 'token' }, tags: { service: 'worker', event: 'database_failed', authorization: 'Bearer secret-token' } });
    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain('secret-token');
    expect(serialized).not.toContain('postgres://');
    expect(serialized).not.toContain('provider payload');
    expect(event.tags).toEqual({ service: 'worker', event: 'database_failed' });
  });
});
