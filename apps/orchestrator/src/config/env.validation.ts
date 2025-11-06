import { z } from 'zod';

export const orchestratorEnvSchema = z.object({
  // Server Configuration
  PORT: z.string().regex(/^\d+$/).optional(),

  // Service Integration URLs
  PIM_SERVICE_URL: z.string().url().optional(),
  WMS_SERVICE_URL: z.string().url().optional(),
});

export type OrchestratorEnvConfig = z.infer<typeof orchestratorEnvSchema>;

export function validateOrchestratorEnv(config: Record<string, unknown>) {
  const parsed = orchestratorEnvSchema.safeParse(config);

  if (!parsed.success) {
    console.error('❌ [Orchestrator] Invalid environment variables:');
    const errors = parsed.error.flatten().fieldErrors;
    Object.entries(errors).forEach(([key, messages]) => {
      console.error(`  - ${key}: ${messages?.join(', ')}`);
    });
    throw new Error('[Orchestrator] Invalid environment variables');
  }

  return parsed.data;
}
