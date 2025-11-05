import { createStep, StepResponse } from '@medusajs/framework/workflows-sdk';

export const logStep = createStep(
  'log-step',
  async (input: { message: string; data: any }) => {
    console.log(`[${input.message}]`, JSON.stringify(input.data, null, 2));
    return new StepResponse(input.data);
  },
);
