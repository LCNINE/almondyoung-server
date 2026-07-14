import {
  ConflictException,
  GoneException,
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const FULFILLMENT_MAINTENANCE_CODE = 'FULFILLMENT_MAINTENANCE';
export const FULFILLMENT_LEGACY_CLOSED_CODE = 'FULFILLMENT_LEGACY_CLOSED';
export const FULFILLMENT_V2_NOT_ACTIVE_CODE = 'FULFILLMENT_V2_NOT_ACTIVE';

export type FulfillmentWorkflowMode = 'legacy' | 'maintenance' | 'v2';
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
    this.mode = this.config.get<FulfillmentWorkflowMode>('FULFILLMENT_WORKFLOW_MODE') ?? 'legacy';

    const configuredCutover = this.config.get<string>('FULFILLMENT_V2_CUTOVER_AT');
    if (configuredCutover) {
      this.cutoverAt = new Date(configuredCutover);
    }
  }

  onModuleInit() {
    const details = this.getHealthDetails();
    this.logger.log(`Fulfillment workflow mode=${details.mode}, cutoverAt=${details.cutoverAt ?? 'not-configured'}`);
  }

  assertMutationAllowed(kind: FulfillmentMutationKind): void {
    this.assertOperationalMutationAllowed(kind);
    if (this.mode === 'v2') {
      throw new GoneException({
        statusCode: 410,
        error: FULFILLMENT_LEGACY_CLOSED_CODE,
        code: FULFILLMENT_LEGACY_CLOSED_CODE,
        message: 'Legacy fulfillment mutations are permanently closed after V2 activation',
        mutationKind: kind,
      });
    }
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

  assertV2MutationAllowed(kind: FulfillmentMutationKind): void {
    this.assertOperationalMutationAllowed(kind);
    if (this.mode !== 'v2') {
      throw new ConflictException({
        statusCode: 409,
        error: FULFILLMENT_V2_NOT_ACTIVE_CODE,
        code: FULFILLMENT_V2_NOT_ACTIVE_CODE,
        message: 'The V2 fulfillment workflow is not active',
        mutationKind: kind,
      });
    }
  }

  shouldEnqueueFo(eventOccurredAt: string | Date | null | undefined, isNewSalesOrder: boolean): boolean {
    if (this.mode === 'maintenance') {
      return false;
    }

    if (this.mode === 'legacy') {
      return true;
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
