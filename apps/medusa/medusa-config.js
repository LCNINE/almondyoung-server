const { loadEnv, defineConfig, Modules, ContainerRegistrationKeys } = require('@medusajs/framework/utils');
const { logger } = require('./src/utils/otel-logger');
const path = require('path');

// apps/medusa/ 폴더
const medusaDir = __dirname;
loadEnv(process.env.NODE_ENV || 'development', medusaDir);

module.exports = defineConfig({
  logger,
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    // Neon serverless DB용 connection pool 최적화
    databaseDriverOptions: {
      connection: {
        ssl: { rejectUnauthorized: false },
      },
      pool: {
        min: 2,
        max: 20,
        idleTimeoutMillis: 30000,
        acquireTimeoutMillis: 10000, // 연결 획득 타임아웃
      },
    },
    redisUrl: process.env.REDIS_URL,
    http: {
      storeCors: process.env.STORE_CORS || '',
      adminCors: process.env.ADMIN_CORS || '',
      authCors: process.env.AUTH_CORS || '',
      jwtSecret: process.env.JWT_SECRET || 'supersecret',
      cookieSecret: process.env.COOKIE_SECRET || 'supersecret',
      jwtExpiresIn: process.env.JWT_EXPIRES_IN || '30d',
      // AUTH_WEB_URL이 설정된 환경(df 등)에서만 user-service-sso 활성화.
      // customer는 OIDC(user-service-sso)만 사용. emailpass는 admin 전용으로 좁힘.
      ...(process.env.AUTH_WEB_URL
        ? {
            authMethodsPerActor: {
              user: ['emailpass', 'my-auth'],
              customer: ['user-service-sso'],
            },
          }
        : {}),
    },
  },
  presets: [require('@medusajs/ui-preset')],

  modules: [
    // Modules.CACHE ("cache") — auth 모듈의 OIDC state 저장소. 기본값(cache-inmemory)을 사용하면
    // 인메모리에만 저장되어 재시작 또는 다중 인스턴스 환경에서 "No state found" 오류가 발생
    {
      resolve: '@medusajs/medusa/cache-redis',
      options: {
        redisUrl: process.env.REDIS_URL,
        ttl: 1800,
      },
    },
    // Modules.CACHING ("caching") — 상품/카탈로그 등 일반 캐시용 (Redis, 새로운 provider API)
    {
      resolve: '@medusajs/medusa/caching',
      options: {
        providers: [
          {
            resolve: '@medusajs/caching-redis',
            id: 'caching-redis',
            is_default: true,
            options: {
              redisUrl: process.env.REDIS_URL,
              namespace: '{medusa-cache}',
            },
          },
        ],
      },
    },
    {
      resolve: '@medusajs/medusa/product',
      options: {},
    },
    {
      resolve: '@medusajs/medusa/auth',
      dependencies: [Modules.CACHE, ContainerRegistrationKeys.LOGGER],
      options: {
        providers: [
          // default provider
          {
            resolve: '@medusajs/medusa/auth-emailpass',
            dependencies: [Modules.CACHE, ContainerRegistrationKeys.LOGGER],
            id: 'emailpass',
            options: {
              hashConfig: {
                logN: 15,
                r: 8,
                p: 1,
              },
            },
          },
          {
            resolve: './src/modules/auth',
            id: 'my-auth',
            options: {
              jwtSecret: process.env.JWT_SECRET,
            },
          },
          // AUTH_WEB_URL이 설정된 환경(df 등)에서만 user-service-sso 활성화
          ...(process.env.AUTH_WEB_URL
            ? [
                {
                  resolve: './src/modules/user-service-sso',
                  id: 'user-service-sso',
                  options: {
                    issuerUrl: process.env.OIDC_ISSUER_URL || process.env.USER_SERVICE_URL,
                    clientId: process.env.OIDC_CLIENT_ID,
                    clientSecret: process.env.OIDC_CLIENT_SECRET,
                    scopes: process.env.OIDC_SCOPES || 'openid email profile',
                    authWebUrl: process.env.AUTH_WEB_URL,
                    userServiceUrl: process.env.USER_SERVICE_URL,
                    defaultCallbackUrl: process.env.SSO_DEFAULT_CALLBACK_URL,
                  },
                },
              ]
            : []),
        ],
      },
    },

    {
      resolve: '@medusajs/medusa/payment',
      options: {
        providers: [
          {
            resolve: './src/modules/almond-payment',
            id: 'almond-payment',
            options: {
              walletBaseUrl: process.env.WALLET_BASE_URL || 'http://localhost:3100',
              walletApiKey: process.env.WALLET_API_KEY || 'dev-secret',
            },
          },
        ],
      },
    },

    {
      resolve: '@medusajs/medusa/file',
      options: {
        providers: [
          {
            resolve: '@medusajs/medusa/file-s3',
            id: 's3',
            options: {
              file_url: process.env.S3_FILE_URL,
              region: process.env.S3_REGION,
              bucket: process.env.S3_BUCKET,
              // 명시적 키가 있으면 access-key 인증, 없으면 iam 인증(SDK 기본 provider chain → ECS task role).
              ...(process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
                ? {
                    authentication_method: 'access-key',
                    access_key_id: process.env.S3_ACCESS_KEY_ID,
                    secret_access_key: process.env.S3_SECRET_ACCESS_KEY,
                  }
                : { authentication_method: 'iam' }),
              ...(process.env.S3_ENDPOINT && {
                endpoint: process.env.S3_ENDPOINT,
              }),
            },
          },
        ],
      },
    },
    {
      resolve: '@medusajs/api-key',
      options: {},
    },
    {
      resolve: './src/modules/product-sorting',
    },
    {
      resolve: './src/modules/promotion-meta',
    },
    {
      resolve: '@medusajs/medusa/promotion',
    },
    {
      resolve: '@medusajs/medusa/event-bus-redis',
      options: {
        redisUrl: process.env.REDIS_URL,
        queueOptions: {
          prefix: '{medusa-events}',
        },
        workerOptions: {
          prefix: '{medusa-events}',
        },
      },
    },
    {
      resolve: '@medusajs/medusa/workflow-engine-redis',
      options: {
        redis: {
          redisUrl: process.env.REDIS_URL,
        },
        queueOptions: {
          prefix: '{medusa-wf}',
        },
        workerOptions: {
          prefix: '{medusa-wf}',
        },
      },
    },
    {
      resolve: '@medusajs/medusa/locking',
      options: {
        providers: [
          {
            resolve: '@medusajs/medusa/locking-redis',
            id: 'locking-redis',
            is_default: true,
            options: {
              redisUrl: process.env.REDIS_URL,
            },
          },
        ],
      },
    },
  ],
  admin: {
    // Admin UI fetch base — Vite inlines this at build time.
    // Without it the bundle ships with the default `http://localhost:9000`,
    // which mixed-content-blocks once the page is served over HTTPS.
    backendUrl: process.env.MEDUSA_BACKEND_URL,
    // Custom Vite config is needed because the admin bundler sometimes
    // fails to resolve `@medusajs/admin-sdk` during Docker builds.
    // Point directly to the installed package to avoid rollup resolution errors.
    vite: () => {
      const adminSdkPath = path.resolve(__dirname, 'node_modules/@medusajs/admin-sdk');

      return {
        resolve: {
          alias: {
            '@medusajs/admin-sdk': adminSdkPath,
          },
        },
        optimizeDeps: {
          include: ['@medusajs/admin-sdk'],
        },
        server: {
          allowedHosts: ['localhost', '127.0.0.1', 'medusa-dev.up.railway.app'],
        },
      };
    },
  },

  plugins: [
    {
      resolve: '@medusajs/draft-order',
      options: {},
    },
  ],
});
