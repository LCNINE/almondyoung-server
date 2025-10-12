export interface SagaContext {
  [key: string]: any;
}

export interface StepFunction<TInput, TOutput> {
  (input: TInput, context: SagaContext): Promise<TOutput>;
}

export interface CompensateFunction<TRollbackData> {
  (rollbackData: TRollbackData, context: SagaContext): Promise<void>;
}

export class StepResponse<TData, TRollback = any> {
  constructor(
    public data: TData,
    public rollbackData?: TRollback,
  ) {}
}

export interface SagaStep<TInput, TOutput, TRollback> {
  name: string;
  execute: StepFunction<TInput, TOutput>;
  compensate?: CompensateFunction<TRollback>;
}
