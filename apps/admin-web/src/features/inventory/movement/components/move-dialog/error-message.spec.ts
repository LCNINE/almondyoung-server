import { movementErrorMessage } from './error-message';

describe('movement rejection guidance', () => {
  it('directs protected inbound stock to an explicit putaway action', () => {
    expect(
      movementErrorMessage({
        statusCode: 409,
        response: { code: 'INBOUND_ORIGIN_STOCK_PROTECTED' },
      })
    ).toBe(
      '이 상품은 적치 대기 중이에요. 창고 앱의 적치에서 입고 건을 선택해 처리해 주세요.'
    );
  });
  it('explains inconsistent origin quantities and keeps unknown errors visible', () => {
    expect(
      movementErrorMessage({
        statusCode: 409,
        response: { code: 'INBOUND_ORIGIN_STOCK_INCONSISTENT' },
      })
    ).toContain('입고내역과 실물');
    expect(movementErrorMessage(new Error('연결 실패'))).toBe('연결 실패');
  });
});
