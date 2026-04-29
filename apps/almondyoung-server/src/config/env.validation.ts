import { z } from 'zod';

export const almondyoungEnvSchema = z.object({
  // Server
  PORT: z.string().regex(/^\d+$/).optional(),
  NODE_ENV: z.string().optional(),

  // Database
  DATABASE_URL: z.string().url(),

  // Auth
  AUTH_SECRET: z.string().min(1),
  JWT_ISSUER: z.string().optional(),
  JWT_AUDIENCE: z.string().optional(),

  // Kafka
  KAFKA_CLIENT_ID_PREFIX: z.string().optional(),
  KAFKA_BROKERS: z.string().min(1),
  KAFKA_GROUP_ID: z.string().optional(),
  KAFKA_API_KEY: z.string().optional(),
  KAFKA_API_SECRET: z.string().optional(),

  // Elasticsearch (Catalog)
  ELASTICSEARCH_NODE: z.string().url().optional(),
  ELASTICSEARCH_USERNAME: z.string().optional(),
  ELASTICSEARCH_PASSWORD: z.string().optional(),
  FILE_SERVICE_URL: z.string().url().optional(),

  // Goodsflow (Fulfillment)
  GOODSFLOW_API_URL: z.string().url().optional(),
  GOODSFLOW_API_KEY: z.string().optional(),
  GOODSFLOW_CENTER_CODE: z.string().optional(),

  // OpenTelemetry
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  OTEL_SERVICE_NAME: z.string().optional(),
});

export type AlmondyoungEnvConfig = z.infer<typeof almondyoungEnvSchema>;

export function validateAlmondyoungEnv(config: Record<string, unknown>) {
  const parsed = almondyoungEnvSchema.safeParse(config);

  if (!parsed.success) {
    console.error('❌ [Almondyoung Server] Invalid environment variables:');
    const errors = parsed.error.flatten().fieldErrors;
    Object.entries(errors).forEach(([key, messages]) => {
      console.error(`  - ${key}: ${messages?.join(', ')}`);
    });
    throw new Error('[Almondyoung Server] Invalid environment variables');
  }

  return parsed.data;
}
