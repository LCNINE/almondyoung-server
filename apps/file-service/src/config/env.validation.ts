import { z } from 'zod';

export const fileServiceEnvSchema = z
  .object({
    // Database
    DATABASE_URL: z.url(),
    PORT: z.string().regex(/^\d+$/),

    // Authentication — dual-mode: AUTH_SECRET (HS256 legacy) 또는 OIDC_ISSUER_URL (RS256/OIDC), 둘 중 하나 필수.
    AUTH_SECRET: z.string().min(1).optional(),
    OIDC_ISSUER_URL: z.string().url().optional(),
    ALLOWED_AUDIENCES: z.string().optional(),

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
      // Access keys remain optional — SDK default provider chain (ECS task role)
      // supplies credentials on Fargate.
      if (data.STORAGE_PROVIDER === 'S3') {
        return data.AWS_REGION && data.AWS_S3_PUBLIC_BUCKET && data.AWS_S3_PRIVATE_BUCKET;
      }
      return true;
    },
    {
      message:
        'AWS_REGION, AWS_S3_PUBLIC_BUCKET, and AWS_S3_PRIVATE_BUCKET are required when STORAGE_PROVIDER is S3',
      path: ['STORAGE_PROVIDER'],
    },
  )
  .refine((data) => !!data.AUTH_SECRET || !!data.OIDC_ISSUER_URL, {
    message: 'Either AUTH_SECRET (HS256) or OIDC_ISSUER_URL (RS256) must be set',
    path: ['AUTH_SECRET'],
  });

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
