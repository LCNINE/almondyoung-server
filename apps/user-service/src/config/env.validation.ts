import { z } from 'zod';

export const userServiceEnvSchema = z.object({
  // Database
  DATABASE_URL: z.string().url(),
  USER_SERVICE_PORT: z.string().regex(/^\d+$/).optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).optional(),

  // CORS Configuration
  CORS_ORIGIN_DOMAIN: z.string().optional(),

  // JWT Configuration
  AUTH_SECRET: z.string(),
  JWT_VERIFICATION_TOKEN_SECRET: z.string(),
  JWT_ACCESS_TOKEN_EXPIRATION: z.string().optional(),
  JWT_REFRESH_SECRET: z.string(),

  // Social Login - Kakao
  KAKAO_CLIENT_ID: z.string(),
  KAKAO_CLIENT_SECRET: z.string(),
  KAKAO_CALLBACK_URL: z.string().url(),

  // AWS S3 Configuration
  AWS_REGION: z.string(),
  AWS_ACCESS_KEY_ID: z.string(),
  AWS_SECRET_ACCESS_KEY: z.string(),
  AWS_S3_BUCKET: z.string(),
});

export type UserServiceEnvConfig = z.infer<typeof userServiceEnvSchema>;

export function validateUserServiceEnv(config: Record<string, unknown>) {
  const parsed = userServiceEnvSchema.safeParse(config);

  if (!parsed.success) {
    console.error('❌ [User Service] Invalid environment variables:');
    const errors = parsed.error.flatten().fieldErrors;
    Object.entries(errors).forEach(([key, messages]) => {
      console.error(`  - ${key}: ${messages?.join(', ')}`);
    });
    throw new Error('[User Service] Invalid environment variables');
  }

  return parsed.data;
}
