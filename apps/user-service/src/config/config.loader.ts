import { GlobalConfig } from './config.type';
import * as dotenv from 'dotenv';

dotenv.config({ path: 'apps/user-service/.env', debug: true });

export default (): GlobalConfig => {
  const database = {
    host: process.env.DB_HOST || '',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USER || '',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || '',
    ssl: {
      rejectUnauthorized: true,
    },
  };

  return {
    database,
    app: {
      nodeEnv: process.env.NODE_ENV || 'development',
      name: process.env.APP_NAME || 'NestJS API',
      workingDirectory: process.env.PWD || process.cwd(),
      url: process.env.APP_URL || 'http://localhost:5000',
      corsOrigin: (process.env.CORS_ORIGIN || 'http://localhost:3000').split(
        ',',
      ),
    },
    auth: {
      authSecret: process.env.AUTH_SECRET || 'secret',
      oAuth: {
        ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
          ? {
              google: {
                clientId: process.env.GOOGLE_CLIENT_ID,
                clientSecret: process.env.GOOGLE_CLIENT_SECRET,
              },
            }
          : {}),
      },
    },
  };
};
