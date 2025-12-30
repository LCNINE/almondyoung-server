const {
  loadEnv,
  defineConfig,
  Modules,
  ContainerRegistrationKeys,
} = require('@medusajs/framework/utils');
const path = require('path');

// apps/medusa/ 폴더
const medusaDir = __dirname;
loadEnv(process.env.NODE_ENV || 'development', medusaDir);

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    // Redis 연결 명시: 없으면 fake redis 사용으로 재시동 루프가 발생할 수 있음
    redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
    http: {
      storeCors: process.env.STORE_CORS || '',
      adminCors: process.env.ADMIN_CORS || '',
      authCors: process.env.AUTH_CORS || '',
      jwtSecret: process.env.JWT_SECRET || 'supersecret',
      cookieSecret: process.env.COOKIE_SECRET || 'supersecret',
      jwtExpiresIn: process.env.JWT_EXPIRES_IN || '30d',
    },
  },
  presets: [require('@medusajs/ui-preset')],

  modules: [
    // Redis 기반 이벤트 버스 명시 (로컬 이벤트 버스 경고 제거)
    {
      resolve: '@medusajs/event-bus-redis',
      key: Modules.EVENT_BUS,
      options: {
        redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
      },
    },
    // 캐시 모듈을 Redis로 명시
    {
      resolve: '@medusajs/cache-redis',
      key: Modules.CACHE,
      options: {
        redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
      },
    },
    // 워크플로우 엔진을 Redis 기반으로 명시
    {
      resolve: '@medusajs/workflow-engine-redis',
      key: Modules.WORKFLOW_ENGINE,
      options: {
        redis: {
          url: process.env.REDIS_URL || 'redis://localhost:6379',
        },
        connection: {
          url: process.env.REDIS_URL || 'redis://localhost:6379',
        },
      },
    },
    // Kafka 연동은 개발/로컬 환경에서는 기본적으로 비활성화.
    // 필요 시 USE_KAFKA=1 환경변수를 설정하면 활성화됩니다.
    ...(process.env.USE_KAFKA === '1'
      ? [
          {
            resolve: './src/modules/events',
            options: {
              kafka: {
                clientId: process.env.KAFKA_CLIENT_ID || 'medusa-service',
                brokers:
                  (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
                groupId: process.env.KAFKA_GROUP_ID || 'medusa-consumer',
              },
            },
          },
        ]
      : []),
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
        ],
      },
    },

    {
      resolve: './src/modules/wms',
      options: {
        apiKey: process.env.WMS_API_URL || 'http://localhost:3001',
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
              apiKey:
                process.env.ALMOND_PAYMENT_API_ENDPOINT ||
                'http://localhost:3000/api/v1',
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
              access_key_id: process.env.S3_ACCESS_KEY_ID,
              secret_access_key: process.env.S3_SECRET_ACCESS_KEY,
              region: process.env.S3_REGION,
              bucket: process.env.S3_BUCKET,
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
    
  ],
  admin: {
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
    // {
    //   resolve: 'almond-digital-asset-plugin',
    //   options: {},
    // },
  ],
});
