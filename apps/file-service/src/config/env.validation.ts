import { z } from 'zod';

export const fileServiceEnvSchema = z
  .object({
    // Database
    DATABASE_URL: z.url(),
    PORT: z.string().regex(/^\d+$/),

    // Authentication
    AUTH_SECRET: z.string().min(1),

    // Kafka Configuration
    KAFKA_CLIENT_ID_PREFIX: z.string(),
    KAFKA_BROKERS: z.string(),
    KAFKA_GROUP_ID: z.string(),
    KAFKA_API_KEY: z.string().optional(),
    KAFKA_API_SECRET: z.string().optional(),

    // Storage Configuration
    STORAGE_PROVIDER: z.enum(['S3', 'LOCAL']).default('S3'),
    AWS_REGION: z.string().optional(),
    AWS_ACCESS_KEY_ID: z.string().optional(),
    AWS_SECRET_ACCESS_KEY: z.string().optional(),
    AWS_S3_PUBLIC_BUCKET: z.string().optional(),
    AWS_S3_PRIVATE_BUCKET: z.string().optional(),
  })
  .refine(
    (data) => {
      if (data.STORAGE_PROVIDER === 'S3') {
        return (
          data.AWS_REGION &&
          data.AWS_ACCESS_KEY_ID &&
          data.AWS_SECRET_ACCESS_KEY &&
          data.AWS_S3_PUBLIC_BUCKET &&
          data.AWS_S3_PRIVATE_BUCKET
        );
      }
      return true;
    },
    {
      message:
        'AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_S3_PUBLIC_BUCKET, and AWS_S3_PRIVATE_BUCKET are required when STORAGE_PROVIDER is S3',
      path: ['STORAGE_PROVIDER'],
    },
  );

export type FileServiceEnvConfig = z.infer<typeof fileServiceEnvSchema>;

export function validateFileServiceEnv(config: Record<string, unknown>) {
  const parsed = fileServiceEnvSchema.safeParse(config);

  if (!parsed.success) {
    console.error('❌ [File Service] Invalid environment variables:');
    const errors = parsed.error.flatten().fieldErrors;
    Object.entries(errors).forEach(([key, messages]) => {
      console.error(`  - ${key}: ${messages?.join(', ')}`);
    });
    throw new Error('[File Service] Invalid environment variables');
  }

  return parsed.data;
}
