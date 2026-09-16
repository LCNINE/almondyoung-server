import { Injectable } from '@nestjs/common';

interface MockableDispatchOperation {
  operation: string;
  channel: string;
  externalOrderId: string;
  salesOrderId: string;
  shipmentId: string | null;
  dispatchAttemptId: string | null;
  providerIdempotencyKey: string;
  requestSnapshot: Record<string, unknown>;
}

@Injectable()
export class DemoChannelDispatchMock {
  acknowledge(operation: MockableDispatchOperation): Record<string, unknown> {
    return {
      mocked: true,
      mode: 'demo',
      operation: operation.operation,
      channel: operation.channel,
      externalOrderId: operation.externalOrderId,
      salesOrderId: operation.salesOrderId,
      shipmentId: operation.shipmentId,
      dispatchAttemptId: operation.dispatchAttemptId,
      providerIdempotencyKey: operation.providerIdempotencyKey,
      requestSnapshot: operation.requestSnapshot,
      acknowledgedAt: new Date().toISOString(),
    };
  }
}
