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
    // RedisUrl이 없으면 Medusa는 자동으로 In-memory(Fake) Redis를 사용합니다.
    // (이로 인해 재부팅 이슈가 생길 수 있으나, debug.log 폴더 트릭으로 막기로 했습니다.)
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
    {
      resolve: "@medusajs/medusa/caching",
      options: {
        providers: [
          {
            resolve: "@medusajs/caching-redis",
            id: "caching-redis",
            is_default: true,
            options: {
              redisUrl: process.env.CACHE_REDIS_URL,
            },
          },
        ],
      },
    },
    {
      resolve: "@medusajs/medusa/event-bus-redis",
      options: {
        redisUrl: process.env.REDIS_URL,
      },
    },
    {
      resolve: "@medusajs/medusa/workflow-engine-redis",
      options: {
        redis: {
          redisUrl: process.env.REDIS_URL,
        },
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