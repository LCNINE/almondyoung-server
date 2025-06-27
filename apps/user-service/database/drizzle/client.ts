import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';
import { ConfigService } from '@nestjs/config';
import { GlobalConfig } from '../../src/config/config.type';

let db: ReturnType<typeof drizzle>;

export function createDrizzle(configService: ConfigService<GlobalConfig>) {
  const dbConfig = configService.getOrThrow('database');

  const pool = new Pool({
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.username,
    password: dbConfig.password,
    database: dbConfig.database,
    ssl: dbConfig.ssl,
  });

  db = drizzle(pool, { schema });
  return db;
}

export { db };
