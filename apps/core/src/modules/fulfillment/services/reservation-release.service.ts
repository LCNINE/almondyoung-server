import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { NotFoundError } from '@app/shared';
import { eq } from 'drizzle-orm';
import { wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { UnifiedReservationService } from '../../inventory/shared/services/unified-reservation.service';
import { ShipmentReservationService } from './shipment-reservation.service';

const DEFAULT_RELEASE_REASON = 'admin-release';

/**
 * 예약 한 행 해제의 진입점. 상자 줄 예약은 상자·출고주문 재계산까지 하는 경로로,
 * 그 밖의 옛 행은 기존 해제 경로로 보낸다. 행 종류는 바뀌지 않으므로 트랜잭션 없이 읽는다.
 */
@Injectable()
export class ReservationReleaseService {
  constructor(
    private readonly db: DbService<typeof wmsSchema>,
    private readonly shipmentReservations: ShipmentReservationService,
    private readonly unifiedReservation: UnifiedReservationService,
  ) {}

  async release(reservationId: string, reason?: string): Promise<void> {
    const [row] = await this.db.db
      .select({ id: wmsTables.stockReservations.id, targetType: wmsTables.stockReservations.targetType })
      .from(wmsTables.stockReservations)
      .where(eq(wmsTables.stockReservations.id, reservationId))
      .limit(1);
    if (!row) throw new NotFoundError('예약을 찾을 수 없습니다');

    if (row.targetType !== 'SHIPMENT_LINE') {
      await this.unifiedReservation.releaseReservation(reservationId);
      return;
    }
    await this.shipmentReservations.releaseReservation(reservationId, reason?.trim() || DEFAULT_RELEASE_REASON);
  }
}
