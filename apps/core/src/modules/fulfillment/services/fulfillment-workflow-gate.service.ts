import { Injectable, Logger, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const FULFILLMENT_MAINTENANCE_CODE = 'FULFILLMENT_MAINTENANCE';

/**
 * `legacy` 는 Task 25 (contract) 에서 제거됐다 — V1 출고 경로가 코드에 없으므로 가리킬 대상이 없다.
 * 옛 값으로 부팅하려는 시도는 env 검증에서 실패해야 한다(조용히 v2 로 넘어가면 사고다).
 */
export type FulfillmentWorkflowMode = 'maintenance' | 'v2';
export type FulfillmentMutationKind =
  | 'shipment.open'
  | 'shipment.inspect'
  | 'shipment.force'
  | 'invoice.issue'
  | 'invoice.print'
  | 'invoice.void'
  | 'consolidation.execute'
  | string;

@Injectable()
export class FulfillmentWorkflowGate implements OnModuleInit {
  private readonly logger = new Logger(FulfillmentWorkflowGate.name);
  private readonly mode: FulfillmentWorkflowMode;
  private readonly cutoverAt?: Date;

  constructor(private readonly config: ConfigService) {
    // 기본값을 두지 않는다. `legacy` 기본값은 "옛 안전 동작 유지" 를 뜻했는데 V1 이 없는 지금은
    // 어떤 기본값도 조용히 실제 운영 모드를 고르는 것이 된다. 누락은 env 검증에서 부팅을 막는다.
    const configured = this.config.get<string>('FULFILLMENT_WORKFLOW_MODE');
    if (configured !== 'maintenance' && configured !== 'v2') {
      throw new Error(
        `FULFILLMENT_WORKFLOW_MODE must be 'maintenance' or 'v2' (got ${JSON.stringify(configured)}). ` +
          `'legacy' was removed with the V1 outbound path in Task 25.`,
      );
    }
    this.mode = configured;

    const configuredCutover = this.config.get<string>('FULFILLMENT_V2_CUTOVER_AT');
    if (configuredCutover) {
      this.cutoverAt = new Date(configuredCutover);
    }
  }

  onModuleInit() {
    const details = this.getHealthDetails();
    this.logger.log(`Fulfillment workflow mode=${details.mode}, cutoverAt=${details.cutoverAt ?? 'not-configured'}`);
  }

  assertOperationalMutationAllowed(kind: FulfillmentMutationKind): void {
    if (this.mode === 'maintenance') {
      throw new ServiceUnavailableException({
        statusCode: 503,
        error: FULFILLMENT_MAINTENANCE_CODE,
        code: FULFILLMENT_MAINTENANCE_CODE,
        message: 'Physical fulfillment mutations are disabled during maintenance',
        mutationKind: kind,
      });
    }
  }

  /**
   * V2 mutation 게이트. 모드가 maintenance|v2 뿐이라 "V2 미활성(409)" 분기는 도달 불가가 되어
   * 제거됐고(maintenance 는 503 이 먼저 나간다), 운영 게이트와 동치다. 호출부 의도(V2 명령임)를
   * 남기기 위해 이름만 유지한다. V1 전용 assertMutationAllowed(410) 는 V1 경로와 함께 제거됐다.
   */
  assertV2MutationAllowed(kind: FulfillmentMutationKind): void {
    this.assertOperationalMutationAllowed(kind);
  }

  shouldEnqueueFo(eventOccurredAt: string | Date | null | undefined, isNewSalesOrder: boolean): boolean {
    if (this.mode === 'maintenance') {
      return false;
    }

    const occurredAt = this.parseEventOccurredAt(eventOccurredAt);
    if (!occurredAt) {
      this.logger.error(
        `FULFILLMENT_CUTOVER_EVENT_TIME_INVALID: refusing FO backlog enqueue; occurredAt=${String(eventOccurredAt)}`,
      );
      return false;
    }

    if (!isNewSalesOrder) {
      return false;
    }

    if (!this.cutoverAt || Number.isNaN(this.cutoverAt.getTime())) {
      // Env validation normally makes this unreachable. Keep the runtime boundary fail-closed.
      this.logger.error('FULFILLMENT_CUTOVER_NOT_CONFIGURED: refusing FO backlog enqueue in v2 mode');
      return false;
    }

    return occurredAt.getTime() >= this.cutoverAt.getTime();
  }

  shouldRunFoCreation(): boolean {
    return this.mode !== 'maintenance';
  }

  shouldRunReservationRetry(): boolean {
    return this.mode !== 'maintenance';
  }

  shouldRunInvoiceRecovery(): boolean {
    return this.mode === 'v2';
  }

  shouldDispatchFulfillmentEvents(): boolean {
    return this.mode !== 'maintenance';
  }

  getMode(): FulfillmentWorkflowMode {
    return this.mode;
  }

  getHealthDetails(): { mode: FulfillmentWorkflowMode; cutoverAt: string | null } {
    return {
      mode: this.mode,
      cutoverAt: this.cutoverAt?.toISOString() ?? null,
    };
  }

  private parseEventOccurredAt(value: string | Date | null | undefined): Date | undefined {
    const occurredAt = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : undefined;
    return occurredAt && !Number.isNaN(occurredAt.getTime()) ? occurredAt : undefined;
  }
}
