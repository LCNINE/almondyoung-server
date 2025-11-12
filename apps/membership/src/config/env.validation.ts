import { z } from 'zod';

export const membershipEnvSchema = z.object({
  // Database
  DATABASE_URL: z.string().url(),
  PORT: z.string().regex(/^\d+$/).optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).optional(),

  // Payment Service Integration
  PAYMENT_SERVER_URL: z.string().url().optional(),
    // JWT Authentication (user-service uses AUTH_SECRET)
  AUTH_SECRET: z.string().min(1),
  JWT_ISSUER: z.string().optional(),
});

export type MembershipEnvConfig = z.infer<typeof membershipEnvSchema>;

export function validateMembershipEnv(config: Record<string, unknown>) {
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
