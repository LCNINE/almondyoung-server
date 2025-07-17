const {
  loadEnv,
  defineConfig,
  Modules,
  ContainerRegistrationKeys,
} = require('@medusajs/framework/utils');

loadEnv(process.env.NODE_ENV || 'development', process.cwd());

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    http: {
      storeCors: process.env.STORE_CORS || '',
      adminCors: process.env.ADMIN_CORS || '',
      authCors: process.env.AUTH_CORS || '',
      jwtSecret: process.env.JWT_SECRET || 'supersecret',
      cookieSecret: process.env.COOKIE_SECRET || 'supersecret',
      jwtExpiresIn: process.env.JWT_EXPIRES_IN || '30d',
    },
  },

  modules: [
    {
      resolve: './src/modules/events',
      options: {
        kafka: {
          clientId: process.env.KAFKA_CLIENT_ID || 'medusa-service',
          brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
          groupId: process.env.KAFKA_GROUP_ID || 'medusa-consumer',
        },
        events: {
          'order.created': {
            topic: 'order.created',
            payload: {
              orderId: String,
            },
          },
          'order.cancelled': {
            topic: 'order.cancelled',
            payload: {
              orderId: String,
            },
          },
        },
        serviceName: 'medusa',
      },
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
              // provider options...
            },
          },
        ],
      },
    },
    {
      resolve: './src/modules/custom-user',
      options: {
        userServiceUrl: process.env.USER_SERVICE_URL,
      },
    },
  ],
  middlewares: {
    store: [
      {
        resolve: './src/api/middlewares',
        options: {},
      },
    ],
  },
});
