import { Injectable, Logger } from '@nestjs/common';
import { type PrintOrderRow } from '../schema/print-order.schema';
import { WowpressClient } from '../wowpress/wowpress.client';
import { WOWPRESS_CARRIER, type WowpressOrderDetail } from '../wowpress/wowpress.types';
import { PrintOrderRepository } from './print-order.repository';

export const WOWPRESS_STATUS_DELIVERED = 85;

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

  private async fillVendorBox(row: PrintOrderRow, boxNumber: string | null): Promise<void> {
    if (!boxNumber || row.vendorBoxNumber) return;

    try {
      await this.repository.saveVendorBox(row.id, { vendorBoxNumber: boxNumber, vendorShippingFee: null });
    } catch (error) {
      this.logger.warn(`print order ${row.id} vendor box save failed: ${errorMessage(error)}`);
    }
  }
}
