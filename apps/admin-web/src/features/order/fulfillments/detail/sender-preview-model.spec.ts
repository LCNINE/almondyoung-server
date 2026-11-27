import { senderGroupsOf, senderLineOf } from './sender-preview-model';
import type { WaybillSenderPreview } from '@/lib/types/dto/fulfillment';

const preview = (
  over: Partial<WaybillSenderPreview> & { shipmentId: string }
): WaybillSenderPreview => ({
  name: '위탁업체',
  source: 'profile',
  beforePlan: false,
  ...over,
});

describe('senderLineOf', () => {
  it('배송 프로필 값이면 이름과 출처', () => {
    expect(senderLineOf(preview({ shipmentId: 'a' }))).toMatchObject({
      name: '위탁업체',
      note: '배송 프로필',
      unknown: false,
    });
  });

  it('기본 송화인으로 대체되면 그렇게 적는다', () => {
    expect(
      senderLineOf(
        preview({ shipmentId: 'a', name: '우리', source: 'default' })
      )
    ).toMatchObject({ name: '우리', note: '기본 송화인으로 대체' });
  });

  it('확정 전 상자는 확정 때 다시 정해진다고 덧붙인다', () => {
    expect(
      senderLineOf(preview({ shipmentId: 'a', beforePlan: true })).note
    ).toBe('배송 프로필 · 상자 확정 때 다시 정해져요');
  });

  it('응답이 없거나 서버가 확인 불가로 답하면 이름을 보이지 않는다', () => {
    expect(senderLineOf(undefined)).toMatchObject({
      name: null,
      unknown: true,
    });
    expect(
      senderLineOf(
        preview({
          shipmentId: 'a',
          name: null,
          source: 'unknown',
          reason: 'carrier_not_configured',
        })
      )
    ).toMatchObject({
      name: null,
      unknown: true,
      note: '택배사 연동 설정이 비어 있어요',
    });
  });
});

describe('senderGroupsOf', () => {
  it('같은 이름·출처끼리 세고, 응답에 빠진 상자는 확인 불가로 맨 뒤에 센다', () => {
    const groups = senderGroupsOf(
      ['a', 'b', 'c', 'd'],
      [
        preview({ shipmentId: 'a' }),
        preview({ shipmentId: 'b', name: '우리', source: 'default' }),
        preview({ shipmentId: 'c' }),
      ]
    );

    expect(groups.map((g) => [g.name, g.note, g.count])).toEqual([
      ['위탁업체', '배송 프로필', 2],
      ['우리', '기본 송화인으로 대체', 1],
      [null, '', 1],
    ]);
  });

  it('조회 실패면 전부 확인 불가', () => {
    expect(senderGroupsOf(['a', 'b'], undefined)).toEqual([
      expect.objectContaining({ unknown: true, count: 2 }),
    ]);
  });
});
