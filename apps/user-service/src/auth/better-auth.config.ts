import { ConfigService } from '@nestjs/config';
import { betterAuth } from 'better-auth';
import { admin, bearer } from 'better-auth/plugins';
import { Pool } from 'pg';
import * as schema from '../../database/drizzle/schema';
import { GlobalConfig } from '../config/config.type';

export function createAuth(configService: ConfigService<GlobalConfig>) {
  const dbConfig = configService.getOrThrow('database');
  const appConfig = configService.getOrThrow('app');
  const authConfig = configService.getOrThrow('auth');

  return betterAuth({
    database: new Pool({
      host: dbConfig.host,
      port: dbConfig.port,
      user: dbConfig.username,
      password: dbConfig.password,
      database: dbConfig.database,
      ssl: dbConfig.ssl,
    }),
    plugins: [admin(), bearer()],
    emailAndPassword: {
      enabled: true,
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
      },
      additionalFields: {
        role: {
          type: 'string',
          defaultValue: 'user',
        },
      },
    },
    schema: {
      ...schema,
    },
    account: {
      modelName: 'accounts',
    },
    verification: {
      modelName: 'verifications',
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
