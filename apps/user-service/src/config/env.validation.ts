import { z } from 'zod';

export const userServiceEnvSchema = z.object({
  // Database
  DATABASE_URL: z.string().url(),
  USER_SERVICE_PORT: z.string().regex(/^\d+$/).optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).optional(),

  // CORS Configuration
  CORS_ORIGIN_DOMAIN: z.string().optional(),
  COOKIE_DOMAIN: z.string().optional(),

  // JWT Configuration
  AUTH_SECRET: z.string(),
  JWT_VERIFICATION_TOKEN_SECRET: z.string(),
  JWT_ACCESS_TOKEN_EXPIRATION: z.string().optional(),
  JWT_REFRESH_SECRET: z.string(),

  // Social Login - Kakao (optional: disabled when not set)
  KAKAO_CLIENT_ID: z.string().optional(),
  KAKAO_CLIENT_SECRET: z.string().optional(),
  KAKAO_CALLBACK_URL: z.string().url().optional(),

  // AWS S3 Configuration
  AWS_REGION: z.string(),
  AWS_ACCESS_KEY_ID: z.string(),
  AWS_SECRET_ACCESS_KEY: z.string(),
  AWS_S3_BUCKET: z.string(),

  // Cafe24 Link (optional: disabled when not set)
  CAFE24_SERVICE_KEY: z.string().optional(),
  CAFE24_API_VERSION: z.string().optional(),

  // Cafe24 OAuth (optional: disabled when not set)
  CAFE24_CLIENT_ID: z.string().optional(),
  CAFE24_CLIENT_SECRET: z.string().optional(),
  CAFE24_TOKEN_URL: z.string().url().optional(),
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
