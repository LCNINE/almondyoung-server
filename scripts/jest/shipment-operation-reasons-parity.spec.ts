import {
  CANCEL_CODES,
  LEGACY_REASON_CODES,
  REQUEST_CHANNELS,
  SHIPMENT_OPERATION_REASONS,
} from 'apps/core/src/modules/fulfillment/shipment/shipment-operation-reasons';
import {
  OPERATION_REASONS,
  REQUEST_CHANNEL_OPTIONS,
  operationReasonLabel,
} from 'apps/admin-web/src/features/order/fulfillments/detail/operation-reasons';

describe('작업 사유 표: core 정본과 admin-web 이름표', () => {
  it('작업 종류가 같다', () => {
    expect(Object.keys(OPERATION_REASONS).sort()).toEqual(Object.keys(SHIPMENT_OPERATION_REASONS).sort());
  });

  it.each(Object.keys(SHIPMENT_OPERATION_REASONS))('%s 의 코드·문구·고객 요청 표시가 같다', (type) => {
    expect(OPERATION_REASONS[type as keyof typeof OPERATION_REASONS]).toEqual(
      SHIPMENT_OPERATION_REASONS[type as keyof typeof SHIPMENT_OPERATION_REASONS],
    );
  });

  it('요청 경로 코드와 문구가 같다', () => {
    expect(REQUEST_CHANNEL_OPTIONS).toEqual(REQUEST_CHANNELS);
  });

  it('core 가 분류해 돌려줄 수 있는 모든 코드에 admin-web 이름표가 있다', () => {
    const unlabeled: string[] = [];
    for (const code of CANCEL_CODES) {
      if (operationReasonLabel('cancel', code, code) === code) unlabeled.push(`cancel:${code}`);
    }
    for (const code of new Set(LEGACY_REASON_CODES.values())) {
      if (operationReasonLabel('split', code, code) === code) unlabeled.push(`automatic:${code}`);
    }
    for (const [type, options] of Object.entries(SHIPMENT_OPERATION_REASONS)) {
      for (const { code } of options) {
        if (code !== 'other' && operationReasonLabel(type, code, code) === code) unlabeled.push(`${type}:${code}`);
      }
    }
    expect(unlabeled).toEqual([]);
  });
});
