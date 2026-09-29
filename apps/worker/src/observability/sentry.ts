import * as Sentry from '@sentry/node';

let enabled = false;
export function initializeSentry(service: string): boolean { const dsn = process.env.SENTRY_DSN?.trim(); if (!dsn) return false; Sentry.init({ dsn, environment: process.env.SENTRY_ENVIRONMENT ?? 'development', release: process.env.SENTRY_RELEASE, initialScope: { tags: { service } } }); enabled = true; return true; }
export function captureUnexpected(error: unknown, context: Record<string, string | undefined>): void { if (!enabled) return; Sentry.withScope((scope) => { scope.setTags(context); Sentry.captureException(error); }); }
