import { Injectable, Logger } from '@nestjs/common';
import { type PrintOrderRow } from '../schema/print-order.schema';
import { WowpressClient } from '../wowpress/wowpress.client';
import {
  WOWPRESS_CARRIER,
  WOWPRESS_JOB_ERRORS,
  WOWPRESS_STATUS_AWAITING_PAYMENT,
  WOWPRESS_STATUS_CANCELLED,
  type WowpressOrderDetail,
} from '../wowpress/wowpress.types';
import { isPreservedLastError, PrintOrderRepository } from './print-order.repository';

export const WOWPRESS_STATUS_DELIVERED = 85;

// 와우프레스에서 사람이 처리해야 하는 상태. 접수 에러는 보드 와우프레스 확인 탭, 취소는 취소 확인 필요 탭이 고른다
export const VENDOR_ATTENTION_PREFIX = 'wowpress needs attention: ';
export const VENDOR_CANCELLED = `${VENDOR_ATTENTION_PREFIX}cancelled`;
export const VENDOR_JOB_ERROR_PREFIX = `${VENDOR_ATTENTION_PREFIX}job error `;

export function vendorAttention(detail: Pick<WowpressOrderDetail, 'ordstat' | 'jobstat'>): string | null {
  if (detail.ordstat === WOWPRESS_STATUS_CANCELLED) return VENDOR_CANCELLED;
  if (detail.jobstat !== null && WOWPRESS_JOB_ERRORS.has(detail.jobstat)) {
    return `${VENDOR_JOB_ERROR_PREFIX}${detail.jobstat}`;
  }

  return null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

@Injectable()
export class PrintOrderTrackingManager {
  private readonly logger = new Logger(PrintOrderTrackingManager.name);

  constructor(
    private readonly repository: PrintOrderRepository,
    private readonly wowpress: WowpressClient,
  ) {}

  // 콜백 본문은 서명이 없어 믿지 않는다. 주문번호로 우리 행을 찾아 주문상세를 다시 불러 반영한다
  async refreshByVendorOrderNumber(ordnum: string): Promise<void> {
    const runs = await this.repository.inEveryDatabase(async () => {
      const row = await this.repository.findTrackedByVendorOrderNumber(ordnum);
      if (row) await this.refresh(row);
    });
    const failed = runs.find((run) => !run.ok);
    // 실패를 던지면 와우프레스가 10초 간격으로 다시 보낸다
    if (failed && !failed.ok) throw failed.error;
  }

  async refresh(row: PrintOrderRow): Promise<void> {
    if (!row.vendorOrderNumber) return;
    let detail: WowpressOrderDetail;
    try {
      detail = await this.wowpress.detail(row.vendorOrderNumber);
    } catch (error) {
      this.logger.warn(`print order ${row.id} tracking poll failed: ${errorMessage(error)}`);
      // 실패한 행도 순서를 뒤로 보낸다. 안 그러면 실패하는 앞쪽 행들이 매 주기 배치를 다 차지한다
      return this.repository.touch(row.id);
    }

    await this.fillVendorBox(row, detail.boxNumber);
    await this.markAwaitingPayment(row, detail.ordstat === WOWPRESS_STATUS_AWAITING_PAYMENT);
    await this.markVendorAttention(row, vendorAttention(detail));

    const now = new Date();
    const invoice = detail.trackingNumber;
    const delivered = detail.ordstat === WOWPRESS_STATUS_DELIVERED;
    if (!invoice && !delivered) return this.repository.touch(row.id);

    const trackingNumber = invoice ?? row.trackingNumber;
    const carrier = invoice ? (WOWPRESS_CARRIER[detail.carrierCode ?? -1] ?? null) : row.carrier;
    const status = delivered ? 'delivered' : 'shipped';
    const shippedAt = row.shippedAt ?? now;
    const deliveredAt = delivered ? (row.deliveredAt ?? now) : null;

    const unchanged =
      row.status === status &&
      row.trackingNumber === trackingNumber &&
      row.carrier === carrier &&
      row.shippedAt !== null &&
      (row.deliveredAt === null) === (deliveredAt === null);
    if (unchanged) return this.repository.touch(row.id);

    const written = await this.repository.updateTracked(row.id, {
      status,
      carrier,
      trackingNumber,
      shippedAt,
      deliveredAt,
    });
    if (!written)
      this.logger.log(`print order ${row.id} left tracking (now cancelling or cancelled); invoice not written`);
  }

  // 선입금이 모자라면 와우프레스가 입금대기에서 생산을 멈춘다. 보드 입금대기 탭이 이 값을 본다
  private async markAwaitingPayment(row: PrintOrderRow, awaiting: boolean): Promise<void> {
    if (row.vendorAwaitingPayment === awaiting) return;

    await this.repository.updateTracked(row.id, { vendorAwaitingPayment: awaiting });
  }

  // 중복 의심 같은 보존 기록은 덮지 않는다. 풀리면 우리가 쓴 기록만 지운다
  private async markVendorAttention(row: PrintOrderRow, attention: string | null): Promise<void> {
    if (row.lastError === attention || isPreservedLastError(row.lastError)) return;
    if (attention === null && !row.lastError?.startsWith(VENDOR_ATTENTION_PREFIX)) return;

    await this.repository.updateTracked(row.id, { lastError: attention });
  }

  private async fillVendorBox(row: PrintOrderRow, boxNumber: string | null): Promise<void> {
    if (!boxNumber || row.vendorBoxNumber) return;

    try {
      await this.repository.saveVendorBox(row.id, { vendorBoxNumber: boxNumber, vendorShippingFee: null });
    } catch (error) {
      this.logger.warn(`print order ${row.id} vendor box save failed: ${errorMessage(error)}`);
    }
  }
}
