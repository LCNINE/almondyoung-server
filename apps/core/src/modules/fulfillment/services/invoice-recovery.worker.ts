import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InvoiceOrchestrator } from './invoice-orchestrator.service';
import { FulfillmentWorkflowGate } from './fulfillment-workflow-gate.service';

@Injectable()
export class InvoiceRecoveryWorker {
  private readonly logger = new Logger(InvoiceRecoveryWorker.name);
  private running = false;

  constructor(
    private readonly invoices: InvoiceOrchestrator,
    private readonly workflowGate: FulfillmentWorkflowGate,
  ) {}

  @Cron(CronExpression.EVERY_10_SECONDS)
  async recover(): Promise<void> {
    if (!this.workflowGate.shouldRunInvoiceRecovery() || this.running) return;
    this.running = true;
    try {
      for (let processed = 0; processed < 20; processed += 1) {
        // Lease only the operation that is about to call the provider. Leasing a batch
        // up front lets later rows expire while an earlier network call is still running.
        const [operationId] = await this.invoices.leaseDueOperations(1);
        if (!operationId) break;
        try {
          await this.invoices.processLeasedOperation(operationId);
        } catch (error) {
          this.logger.error(`Invoice recovery failed for operation ${operationId}`, error);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
