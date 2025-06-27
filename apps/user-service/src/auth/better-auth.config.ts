import { ConfigService } from '@nestjs/config';
import { betterAuth } from 'better-auth';
import { admin, bearer } from 'better-auth/plugins';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { createDrizzle } from '../../database/drizzle/client';
import * as schema from '../../database/drizzle/schema';
import { GlobalConfig } from '../config/config.type';
import * as crypto from 'crypto';

export function createAuth(configService: ConfigService<GlobalConfig>) {
  const appConfig = configService.getOrThrow('app');
  const authConfig = configService.getOrThrow('auth');

  const db = createDrizzle(configService);

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        users: schema.users,
      },
    }),
    plugins: [admin(), bearer()],
    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
    },
    session: {
      freshAge: 10,
      modelName: 'sessions',
      cookie: {
        name: 'auth',
        httpOnly: true,
        secure: appConfig.nodeEnv === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7일
      },
    },
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
      idGenerator: () => crypto.randomUUID(),
    },
    schema: {
      users: schema.users,
    },
    account: {
      modelName: 'accounts',
      idGenerator: () => crypto.randomUUID(),
    },
    verification: {
      modelName: 'verifications',
      idGenerator: () => crypto.randomUUID(),
    },
    token: {
      modelName: 'tokens',
      idGenerator: () => crypto.randomUUID(),
    },
    socialProviders: {
      ...(authConfig.oAuth.google
        ? {
            google: {
              clientId: authConfig.oAuth.google.clientId,
              clientSecret: authConfig.oAuth.google.clientSecret,
            },
          }
        : {}),
    },
  });
}
