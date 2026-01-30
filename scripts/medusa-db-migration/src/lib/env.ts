import { config } from 'dotenv';
import path from 'path';

const envPath = path.resolve(__dirname, '../../.env');
console.log('envPath=', envPath);
config({ path: envPath, override: true });

try {
  if (process.env.PIM_SOURCE_DB_URL) {
    const parsed = new URL(process.env.PIM_SOURCE_DB_URL);
    console.log('PIM parsed user=', parsed.username, 'host=', parsed.host);
  }
  if (process.env.MEDUSA_DATABASE_URL) {
    const parsed = new URL(process.env.MEDUSA_DATABASE_URL);
    console.log('MEDUSA parsed user=', parsed.username, 'host=', parsed.host);
  }
} catch (error) {
  console.warn('Failed to parse database URL', error);
}

export function getRequiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing env: ${key}`);
  }
  return value;
}

export function isWriteEnabled(): boolean {
  return process.env.ALLOW_DB_WRITES === 'true';
}

export function isDryRunFlag(): boolean {
  return process.env.DRY_RUN === 'true';
}
