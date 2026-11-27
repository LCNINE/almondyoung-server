import {
  reissueSenderText,
  senderGroupsOf,
  senderLineOf,
} from './sender-preview-model';
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

  it('이름이 같아도 전화나 출고지가 다르면 다른 묶음으로 센다', () => {
    const origin = { zip: '1', baseAddress: '주소', detailAddress: '' };
    const groups = senderGroupsOf(
      ['a', 'b', 'c'],
      [
        preview({
          shipmentId: 'a',
          phone: '02-1',
          phoneSource: 'profile',
          origin,
          originSource: 'profile',
        }),
        preview({
          shipmentId: 'b',
          phone: '02-1',
          phoneSource: 'profile',
          origin,
          originSource: 'profile',
        }),
        preview({
          shipmentId: 'c',
          phone: '02-9',
          phoneSource: 'default',
          origin,
          originSource: 'profile',
        }),
      ]
    );

    expect(groups.map((g) => [g.phone.text, g.origin.text, g.count])).toEqual([
      ['02-1', '(1) 주소', 2],
      ['02-9', '(1) 주소', 1],
    ]);
  });

  it('조회 실패면 전부 확인 불가', () => {
    expect(senderGroupsOf(['a', 'b'], undefined)).toEqual([
      expect.objectContaining({ unknown: true, count: 2 }),
    ]);
  });
});

describe('reissueSenderText', () => {
  it('바뀌는 칸마다 그 칸의 출처를 적는다 — 이름은 프로필, 전화는 기본값일 수 있다', () => {
    const origin = {
      zip: '1',
      baseAddress: '주소',
      detailAddress: '상세주소 없음',
    };
    expect(
      reissueSenderText(
        preview({
          shipmentId: 'a',
          name: '옛 이름',
          source: 'waybill',
          phone: '02-1',
          phoneSource: 'waybill',
          origin,
          originSource: 'waybill',
          reissue: {
            name: '위탁업체',
            source: 'profile',
            phone: '02-9',
            phoneSource: 'default',
            origin,
            originSource: 'default',
          },
        })
      )
    ).toBe(
      '재발급하면 이름 위탁업체(배송 프로필), 전화 02-9(기본값으로 대체)로 바뀌어요'
    );
  });

  it('재발급 정보가 없으면 아무것도 알리지 않는다', () => {
    expect(reissueSenderText(undefined)).toBeNull();
    expect(reissueSenderText(preview({ shipmentId: 'a' }))).toBeNull();
  });
});
