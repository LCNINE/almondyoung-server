import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db } from '../../database/client';
import * as schema from '../../database/drizzle/schema';
import { bearer, jwt } from 'better-auth/plugins';

export const auth = betterAuth({
  plugins: [
    bearer(), // Bearer token authorization
    jwt(),
  ],
  database: drizzleAdapter(db, {
    schema: schema,
    provider: 'pg',
    usePlural: true,
  }),
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
  },
  appName: 'MyApp',
});
