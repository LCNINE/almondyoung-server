const { loadEnv, defineConfig } = require('@medusajs/framework/utils');

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
    },
  },
  modules: [
    {
      resolve: '../../libs/shared/src/events/src',
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
  ],
});
