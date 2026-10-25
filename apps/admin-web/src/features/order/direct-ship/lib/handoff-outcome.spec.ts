import type { SupplierSheet, SupplierSheetRow } from '@/lib/types/dto/fulfillment';
import type { PiiMeta } from '@/lib/pii/pii-notices';
import { SHEET_MASKED_MESSAGE } from './supplier-sheet-xlsx';
import { REDOWNLOAD_EMPTY_MESSAGE, handoffOutcome, redownloadOutcome } from './handoff-outcome';

const ROW: SupplierSheetRow = {
  rowKey: 'foi-1',
  orderNo: '20261026-0001',
  productName: '샴푸',
  supplierSku: '',
  qty: 1,
  recipientName: '홍길동',
  recipientPhone: '01012345678',
  address: '서울',
  entrancePassword: '',
  deliveryMemo: '',
  carrier: '',
  trackingNo: '',
  unfulfillableReason: '',
  salesOrderId: 'so-1',
};

const sheet = (skipped: string[], rows: SupplierSheetRow[] = []): SupplierSheet => ({
  handoffId: 'h-1',
  supplierId: 's-1',
  fileName: 'x.xlsx',
  columns: [],
  rows,
  skippedShipments: skipped.map((shipmentId) => ({ shipmentId, reason: 'RECIPIENT_INCOMPLETE' })),
});
const MASKED: PiiMeta = { maskedKinds: ['name'], reason: 'no-permission', redactedPaths: [], revealable: false };

describe('handoffOutcome', () => {
  it('가린 것도 빠진 상자도 없으면 내려받기만', () => {
    expect(handoffOutcome({ sheet: sheet([]), pii: null })).toEqual({
      download: true,
      maskedMessage: null,
      skipped: null,
      emptyMessage: null,
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
      emptyMessage: null,
    });
  });

  it('가린 시트는 내려받지 않고 문구를 낸다, 빠진 상자 안내는 따로 남는다', () => {
    const out = handoffOutcome({ sheet: sheet(['sh-1']), pii: MASKED });
    expect(out.download).toBe(false);
    expect(out.maskedMessage).toBe(SHEET_MASKED_MESSAGE);
    expect(out.skipped?.shipmentIds).toEqual(['sh-1']);
  });
});

describe('redownloadOutcome', () => {
  it('줄이 있고 가린 것·빠진 것이 없으면 내려받기만', () => {
    expect(redownloadOutcome({ sheet: sheet([], [ROW]), pii: null })).toEqual({
      download: true,
      maskedMessage: null,
      skipped: null,
      emptyMessage: null,
    });
  });

  it('빠진 상자는 «이 시트에 싣지 않았다»로 수와 id 를 알리고, 남은 줄은 내려받는다', () => {
    expect(redownloadOutcome({ sheet: sheet(['sh-1', 'sh-2'], [ROW]), pii: null })).toEqual({
      download: true,
      maskedMessage: null,
      skipped: {
        message: '받는 분 정보가 빠진 상자 2개는 이 시트에 싣지 않았습니다',
        shipmentIds: ['sh-1', 'sh-2'],
      },
      emptyMessage: null,
    });
  });

  it('줄이 없으면 머리글뿐인 파일을 받지 않는다', () => {
    expect(redownloadOutcome({ sheet: sheet([], []), pii: null })).toEqual({
      download: false,
      maskedMessage: null,
      skipped: null,
      emptyMessage: REDOWNLOAD_EMPTY_MESSAGE,
    });
    expect(REDOWNLOAD_EMPTY_MESSAGE).toBe('다시 받을 상자가 없습니다');
  });

  it('줄이 없고 다 빠졌으면 빈 안내와 빠진 상자를 같이 알린다', () => {
    const out = redownloadOutcome({ sheet: sheet(['sh-1'], []), pii: null });
    expect(out.download).toBe(false);
    expect(out.emptyMessage).toBe(REDOWNLOAD_EMPTY_MESSAGE);
    expect(out.skipped?.shipmentIds).toEqual(['sh-1']);
  });

  it('줄이 없으면 가린 시트여도 «다시 받으라»는 가림 문구를 내지 않는다', () => {
    const out = redownloadOutcome({ sheet: sheet([], []), pii: MASKED });
    expect(out.maskedMessage).toBeNull();
    expect(out.emptyMessage).toBe(REDOWNLOAD_EMPTY_MESSAGE);
  });

  it('줄이 있는 가린 시트는 내려받지 않고 가림 문구, 빠진 상자 안내는 남는다', () => {
    const out = redownloadOutcome({ sheet: sheet(['sh-1'], [ROW]), pii: MASKED });
    expect(out.download).toBe(false);
    expect(out.maskedMessage).toBe(SHEET_MASKED_MESSAGE);
    expect(out.skipped?.shipmentIds).toEqual(['sh-1']);
  });
});
