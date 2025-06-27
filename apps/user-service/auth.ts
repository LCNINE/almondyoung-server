import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import * as schema from './database/drizzle/schema';

// TODO 이건 임시파일임 npx @better-auth/cli generate
const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  ssl: process.env.DB_SSL === 'true',
});

const db = drizzle(pool, { schema });

export default {
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      users: schema.users,
    },
  }),
  user: {
    modelName: 'users',
    fields: {
      name: 'username',
      emailVerified: 'email_verified',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      id: 'id',
      password: 'password',
      email: 'email',
    },
    additionalFields: {
      role: {
        type: 'string',
        defaultValue: 'user',
        required: false,
      },
    },
  },
  schema: {
    users: schema.users,
  },
};
