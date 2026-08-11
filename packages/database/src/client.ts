import { config } from 'dotenv';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from './schema/index.js';

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');

config({ path: resolve(packageDirectory, '../../.env'), quiet: true });

const databaseUrl = process.env.DATABASE_URL;

export const pool = new Pool(databaseUrl ? { connectionString: databaseUrl } : {});

export const db = drizzle({ client: pool, schema });

export async function closeDatabase(): Promise<void> {
  await pool.end();
}

export async function checkDatabaseConnection(): Promise<void> {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not configured.');
  }

  await db.execute(sql`SELECT 1`);
}
