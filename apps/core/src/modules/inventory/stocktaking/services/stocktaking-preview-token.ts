import { createHash } from 'crypto';
import { canonicalWarehouseRequest } from '../../core/services/warehouse-operation-contract';

export interface ReviewedCount {
  lineId: string;
  lineRevision: number;
  baselineVersion: number;
  currentLedgerVersion: number;
  countedQuantity: number;
  currentOnHand: number;
}

export function stocktakingPreviewToken(sessionId: string, sessionRevision: number, lines: ReviewedCount[]): string {
  return createHash('sha256')
    .update(
      JSON.stringify(
        canonicalWarehouseRequest({
          sessionId,
          sessionRevision,
          lines: [...lines].sort((a, b) => a.lineId.localeCompare(b.lineId)),
        }),
      ),
    )
    .digest('hex');
}
