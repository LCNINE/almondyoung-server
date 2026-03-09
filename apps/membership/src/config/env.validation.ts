import { z } from 'zod';

export const membershipEnvSchema = z.object({
  // Database
  DATABASE_URL: z.string().url(),
  PORT: z.string().regex(/^\d+$/).optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).optional(),

  // Payment Service Integration
  PAYMENT_SERVER_URL: z.string().url().optional(),
  WALLET_API_URL: z.string().url().optional(),
  WALLET_API_KEY: z.string().min(1).optional(),
  // JWT Authentication (user-service uses AUTH_SECRET)
  AUTH_SECRET: z.string().min(1).default('ewfisdfdsfdsfdsf123@324'), // Railway 환경 변수 이슈 임시 우회
  JWT_ISSUER: z.string().optional(),
});

export type MembershipEnvConfig = z.infer<typeof membershipEnvSchema>;

export function validateMembershipEnv(config: Record<string, unknown>) {
  // 디버깅: 실제 환경 변수 확인
  console.log('🔍 [Membership] Environment variables check:');
  console.log(
    '  - DATABASE_URL:',
    config.DATABASE_URL ? '✅ exists' : '❌ missing',
  );
  console.log(
    '  - AUTH_SECRET:',
    config.AUTH_SECRET ? '✅ exists' : '❌ missing',
  );
  console.log(
    '  - JWT_ISSUER:',
    config.JWT_ISSUER ? '✅ exists' : '❌ missing',
  );
  console.log(
    '  - All env keys:',
    Object.keys(config).filter((k) => k.includes('AUTH') || k.includes('JWT')),
  );

  const parsed = membershipEnvSchema.safeParse(config);

  if (!parsed.success) {
    console.error('❌ [Membership] Invalid environment variables:');
    const errors = parsed.error.flatten().fieldErrors;
    Object.entries(errors).forEach(([key, messages]) => {
      console.error(`  - ${key}: ${messages?.join(', ')}`);
    });
    throw new Error('[Membership] Invalid environment variables');
  }

  return parsed.data;
}
