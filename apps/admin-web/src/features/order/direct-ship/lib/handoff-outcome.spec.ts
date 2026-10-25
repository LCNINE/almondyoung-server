import type { SupplierSheet } from '@/lib/types/dto/fulfillment';
import type { PiiMeta } from '@/lib/pii/pii-notices';
import { SHEET_MASKED_MESSAGE } from './supplier-sheet-xlsx';
import { handoffOutcome } from './handoff-outcome';

const sheet = (skipped: string[]): SupplierSheet => ({
  handoffId: 'h-1',
  supplierId: 's-1',
  fileName: 'x.xlsx',
  columns: [],
  rows: [],
  skippedShipments: skipped.map((shipmentId) => ({ shipmentId, reason: 'RECIPIENT_INCOMPLETE' })),
});
const MASKED: PiiMeta = { maskedKinds: ['name'], reason: 'no-permission', redactedPaths: [], revealable: false };

describe('handoffOutcome', () => {
  it('가린 것도 빠진 상자도 없으면 내려받기만', () => {
    expect(handoffOutcome({ sheet: sheet([]), pii: null })).toEqual({
      download: true,
      maskedMessage: null,
      skipped: null,
    });
  });

  it('빠진 상자가 있으면 수와 id 를 알린다(대기로 남는다)', () => {
    expect(handoffOutcome({ sheet: sheet(['sh-1', 'sh-2']), pii: null })).toEqual({
      download: true,
      maskedMessage: null,
      skipped: {
        message: '받는 분 정보가 빠진 상자 2개는 넘기지 않았습니다',
        shipmentIds: ['sh-1', 'sh-2'],
      },
    });
  });

  it('가린 시트는 내려받지 않고 문구를 낸다, 빠진 상자 안내는 따로 남는다', () => {
    const out = handoffOutcome({ sheet: sheet(['sh-1']), pii: MASKED });
    expect(out.download).toBe(false);
    expect(out.maskedMessage).toBe(SHEET_MASKED_MESSAGE);
    expect(out.skipped?.shipmentIds).toEqual(['sh-1']);
  });
});
