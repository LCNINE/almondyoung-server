import { SagaStep, StepFunction, CompensateFunction, StepResponse } from './saga.types';

export function createStep<TInput, TOutput, TRollback = any>(
  name: string,
  execute: StepFunction<TInput, TOutput>,
  compensate?: CompensateFunction<TRollback>,
): SagaStep<TInput, TOutput, TRollback> {
  return { name, execute, compensate };
}

export { StepResponse };
