import { config } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const applicationDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');

config({ path: resolve(applicationDirectory, '../../.env'), quiet: true });

export const temporalAddress = process.env.TEMPORAL_ADDRESS ?? 'localhost:7233';
export const temporalTaskQueue = process.env.TEMPORAL_TASK_QUEUE ?? 'rental-rate-helper';
