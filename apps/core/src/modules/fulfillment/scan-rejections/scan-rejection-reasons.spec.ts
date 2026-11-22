import { BadRequestException, ConflictException } from '@nestjs/common';
import { ConflictError } from '@app/shared';
import { recordableRejection, scanRejectionReason } from './scan-rejection-reasons';

describe('관리자 화면에 남길 출고 저장 거절', () => {
  it('코드를 응답 필터와 같은 순서(code → error)로 읽는다', () => {
    expect(recordableRejection(new ConflictException({ code: 'SHIPMENT_TOTE_NOT_RELEASED', message: 'x' }))).toEqual({
      code: 'SHIPMENT_TOTE_NOT_RELEASED',
      reasonCode: null,
    });
    expect(recordableRejection(new ConflictException({ error: 'WORK_ITEM_HANDOFF_REQUIRED', message: 'x' }))).toEqual({
      code: 'WORK_ITEM_HANDOFF_REQUIRED',
      reasonCode: null,
    });
  });

  it('코드 없는 409 와 도메인 충돌도 남긴다', () => {
    expect(recordableRejection(new ConflictException('locked'))).toEqual({ code: 'CONFLICT', reasonCode: null });
    expect(recordableRejection(new ConflictError('WAYBILL_NOT_DISPATCHABLE: used'))).toEqual({
      code: 'WAYBILL_NOT_DISPATCHABLE',
      reasonCode: null,
    });
    expect(recordableRejection(new ConflictError('plain'))).toEqual({ code: 'CONFLICT', reasonCode: null });
  });

  it('출고 준비가 막힌 거절은 세부 사유를 함께 남기되, 작업 시작 전 배치는 남기지 않는다', () => {
    const blocked = (reasonCode: string) =>
      new ConflictException({
        code: 'SIMPLE_OUTBOUND_PLAN_INVALIDATED',
        error: 'SIMPLE_OUTBOUND_PLAN_INVALIDATED',
        message: 'x',
        details: { reasonCode, recovery: 'review_batch' },
      });
    expect(recordableRejection(blocked('ACTIVE_WORK_REQUIRES_REVIEW'))).toEqual({
      code: 'SIMPLE_OUTBOUND_PLAN_INVALIDATED',
      reasonCode: 'ACTIVE_WORK_REQUIRES_REVIEW',
    });
    expect(recordableRejection(blocked('BATCH_NOT_STARTED'))).toBeNull();
  });

  it.each([
    'FULFILLMENT_COMMAND_IN_PROGRESS',
    'FULFILLMENT_IDEMPOTENCY_MISMATCH',
    'SIMPLE_OUTBOUND_SKU_NOT_IN_SHIPMENT',
    'SIMPLE_OUTBOUND_OVERSCAN',
    'WORK_ITEM_STALE_LEASE_VERSION',
    'FULFILLMENT_INVARIANT_COMPONENT_CHANGED_RETRY',
    'LABEL_REPRINT_REQUIRED',
  ])('작업자가 풀 거절 %s 는 남기지 않는다', (code) => {
    expect(recordableRejection(new ConflictException({ code, message: 'x' }))).toBeNull();
  });

  it('409 가 아니면 남기지 않는다', () => {
    expect(recordableRejection(new BadRequestException({ code: 'SHIPMENT_TOTE_NOT_RELEASED' }))).toBeNull();
    expect(recordableRejection(new Error('boom'))).toBeNull();
  });

  it('모르는 코드도 코드를 붙인 문장과 상자 확인으로 보인다', () => {
    expect(scanRejectionReason('SOMETHING_NEW')).toEqual({
      message: expect.stringContaining('SOMETHING_NEW'),
      action: 'review_box',
    });
    expect(scanRejectionReason('SHIPMENT_TOTE_NOT_RELEASED').action).toBe('release_tote');
  });
});
