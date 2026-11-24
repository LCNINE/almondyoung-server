import { Injectable } from '@nestjs/common';
import { CarrierTrackingManager } from './carrier-tracking.manager';
import { CarrierTrackingReader, pollingOf, type TrackedAttempt } from './carrier-tracking.reader';
import type { TrackingConfirmationFacts } from './carrier-tracking.judge';
import {
  CarrierTrackingAttentionDto,
  CarrierTrackingConfirmResultDto,
  CarrierTrackingItemDto,
  CarrierTrackingPollingDto,
  CarrierTrackingShipmentDto,
  CarrierTrackingSummaryDto,
  ConfirmCarrierTrackingDto,
} from './dto/carrier-tracking.dto';

/** 한 화면에 그리는 줄 수. 수는 전부 센다. */
const ITEM_LIMIT = 200;

@Injectable()
export class CarrierTrackingService {
  constructor(
    private readonly reader: CarrierTrackingReader,
    private readonly manager: CarrierTrackingManager,
  ) {}

  async summary(): Promise<CarrierTrackingSummaryDto> {
    const now = new Date();
    const rows = await this.reader.listOpen(now);
    return { attention: rows.filter((row) => row.judgement.raised).length, polling: toPolling(rows, now) };
  }

  async attention(): Promise<CarrierTrackingAttentionDto> {
    const now = new Date();
    const rows = await this.reader.listOpen(now);
    const raised = rows.filter((row) => row.judgement.raised);
    const waiting = rows.filter(
      (row) => row.judgement.kind !== null && !row.judgement.raised && row.confirmation?.outcome === 'wait',
    );
    return {
      attention: raised.length,
      waiting: waiting.length,
      polling: toPolling(rows, now),
      items: await this.toItems([...raised, ...waiting].slice(0, ITEM_LIMIT)),
    };
  }

  async forShipment(shipmentId: string): Promise<CarrierTrackingShipmentDto> {
    return { items: await this.toItems(await this.reader.listForShipment(shipmentId, new Date())) };
  }

  async recheck(dispatchAttemptId: string): Promise<CarrierTrackingShipmentDto> {
    return this.forShipment(await this.manager.recheck(dispatchAttemptId));
  }

  confirm(
    dispatchAttemptId: string,
    dto: ConfirmCarrierTrackingDto,
    idempotencyKey: string,
    actorId: string,
  ): Promise<CarrierTrackingConfirmResultDto> {
    return this.manager.confirm(dispatchAttemptId, dto, idempotencyKey, actorId);
  }

  private async toItems(rows: TrackedAttempt[]): Promise<CarrierTrackingItemDto[]> {
    const [orders, confirmations] = await Promise.all([
      this.reader.ordersOf([...new Set(rows.map((row) => row.shipmentId))]),
      this.reader.confirmationsOf(rows.map((row) => row.dispatchAttemptId)),
    ]);
    return rows.map((row) => ({
      dispatchAttemptId: row.dispatchAttemptId,
      attemptNo: row.attemptNo,
      shipmentId: row.shipmentId,
      carrier: row.carrier,
      trackingNo: row.trackingNo,
      orders: orders.get(row.shipmentId) ?? [],
      kind: row.judgement.kind,
      raised: row.judgement.raised,
      accepted: row.judgement.accepted,
      recalled: row.attemptStatus === 'recalled',
      dispatchedAt: row.dispatchedAt.toISOString(),
      dueAt: row.judgement.dueAt.toISOString(),
      attemptedAt: row.check?.attemptedAt.toISOString() ?? null,
      answeredAt: row.check?.answeredAt?.toISOString() ?? null,
      lastOutcome: row.check?.outcome ?? null,
      scan:
        row.check?.scanCode && row.check.scanStatus && row.check.scanAt
          ? {
              code: row.check.scanCode,
              status: row.check.scanStatus,
              at: row.check.scanAt.toISOString(),
              location: row.check.scanLocation,
              reason: row.check.scanReason,
            }
          : null,
      scanKey: row.judgement.scanKey,
      confirmations: (confirmations.get(row.dispatchAttemptId) ?? []).map(toConfirmation),
    }));
  }
}

function toPolling(rows: TrackedAttempt[], now: Date): CarrierTrackingPollingDto {
  const polling = pollingOf(rows, now);
  return { lastAnsweredAt: polling.lastAnsweredAt?.toISOString() ?? null, failing: polling.failing };
}

function toConfirmation(row: TrackingConfirmationFacts) {
  return {
    id: row.id,
    kind: row.kind,
    outcome: row.outcome,
    resumeAt: row.resumeAt?.toISOString() ?? null,
    note: row.note,
    actorId: row.actorId,
    createdAt: row.createdAt.toISOString(),
  };
}
