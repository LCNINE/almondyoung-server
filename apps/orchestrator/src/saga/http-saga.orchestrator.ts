import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { SagaStep, SagaContext } from './saga.types';

@Injectable()
export class HttpSagaOrchestrator {
  protected readonly logger: Logger;
  private steps: SagaStep<any, any, any>[] = [];
  private executedSteps: Array<{
    step: SagaStep<any, any, any>;
    rollbackData: any;
  }> = [];

  constructor(protected readonly httpService: HttpService) {
    this.logger = new Logger(this.constructor.name);
  }

  /**
   * Step 추가
   */
  addStep<TInput, TOutput, TRollback>(
    step: SagaStep<TInput, TOutput, TRollback>,
  ): this {
    this.steps.push(step);
    return this;
  }

  /**
   * 워크플로우 실행
   */
  async execute<TContext extends SagaContext>(
    initialContext: TContext,
  ): Promise<TContext> {
    try {
      let context = { ...initialContext };

      for (const step of this.steps) {
        this.logger.log(`🔄 [Saga] Executing: ${step.name}`);

        const result = await step.execute(context.input, context);

        this.executedSteps.push({
          step,
          rollbackData: result.rollbackData ?? result.data,
        });

        // 다음 Step에서 사용할 수 있도록 context 업데이트
        context = { ...context, ...result.data };
      }

      this.logger.log('✅ [Saga] All steps completed successfully');
      return context;
    } catch (error) {
      this.logger.error(
        '❌ [Saga] Error occurred, initiating rollback...',
        error,
      );
      await this.rollback();
      throw error;
    }
  }

  /**
   * 보상 트랜잭션 실행 (역순)
   */
  private async rollback(): Promise<void> {
    for (const { step, rollbackData } of this.executedSteps.reverse()) {
      if (!step.compensate) {
        this.logger.warn(`⚠️  [Saga] No compensation for: ${step.name}`);
        continue;
      }

      try {
        this.logger.log(`🔙 [Saga] Compensating: ${step.name}`);
        await step.compensate(rollbackData, {});
      } catch (error) {
        this.logger.error(
          `❌ [Saga] Compensation failed for ${step.name}:`,
          error.message,
        );
        // Best-effort rollback: 실패해도 계속 진행
      }
    }
  }

  /**
   * HTTP 헬퍼 메서드
   */
  protected async httpPost<T>(url: string, data: any): Promise<T> {
    const response = await firstValueFrom(this.httpService.post<T>(url, data));
    return response.data;
  }

  protected async httpDelete(url: string): Promise<void> {
    await firstValueFrom(this.httpService.delete(url));
  }

  protected async httpGet<T>(url: string): Promise<T> {
    const response = await firstValueFrom(this.httpService.get<T>(url));
    return response.data;
  }

  protected async httpPut<T>(url: string, data: any): Promise<T> {
    const response = await firstValueFrom(this.httpService.put<T>(url, data));
    return response.data;
  }
}
