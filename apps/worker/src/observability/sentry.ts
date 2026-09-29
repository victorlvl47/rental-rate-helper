import * as Sentry from '@sentry/node';

type SafeContext = Record<string, string | undefined>;
const allowedContextKeys = new Set(['service', 'component', 'event', 'failure_type']);
let enabled = false;

export function sanitizeSentryEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  const tags = Object.fromEntries(Object.entries(event.tags ?? {}).filter(([key, value]) => allowedContextKeys.has(key) && typeof value === 'string'));
  return { ...event, message: undefined, exception: { values: [{ type: 'SafeOperationalError', value: 'Unexpected internal failure.' }] }, request: undefined, contexts: undefined, user: undefined, breadcrumbs: undefined, extra: undefined, tags };
}

export function initializeSentry(service: string): boolean {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) { enabled = false; return false; }
  Sentry.init({ dsn, environment: process.env.SENTRY_ENVIRONMENT ?? 'development', release: process.env.SENTRY_RELEASE, initialScope: { tags: { service } }, beforeSend: sanitizeSentryEvent });
  enabled = true;
  return true;
}

export function isSentryEnabled(): boolean { return enabled; }

export function captureUnexpected(_error: unknown, context: SafeContext): void {
  if (!enabled) return;
  const tags = Object.fromEntries(Object.entries(context).filter(([key, value]) => allowedContextKeys.has(key) && value !== undefined)) as Record<string, string>;
  Sentry.withScope((scope) => { scope.setTags(tags); Sentry.captureException(new Error('Unexpected internal failure.')); });
}
