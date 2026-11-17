import type { DeliveryProfileDto } from '@/lib/types/dto/inventory';
import {
  emptyProfileForm,
  formFromProfile,
  toCreatePayload,
  toUpdatePayload,
  validateProfileForm,
  copiedProfileForm,
  type ProfileFormState,
} from './profile-form';

function filled(overrides: Partial<ProfileFormState> = {}): ProfileFormState {
  return {
    ...emptyProfileForm(),
    name: '부천 자사 출고',
    senderName: '엘씨나인',
    senderPhone: '1877-7184',
    originPostalCode: '14521',
    originRoadAddress: '부천시 평천로832번길 42',
    originDetailAddress: '4층',
    returnPostalCode: '14521',
    returnRoadAddress: '부천시 평천로832번길 42',
    returnDetailAddress: '',
    carrierAccountRef: 'HANJIN',
    returnSameAsOrigin: false,
    ...overrides,
  };
}

const profile: DeliveryProfileDto = {
  id: 'p1',
  name: '부천 자사 출고',
  sourceType: 'in_house',
  holderId: null,
  avgDeliveryDays: null,
  sender: { name: '엘씨나인', phone: '1877-7184' },
  originAddress: {
    postalCode: '14521',
    roadAddress: '부천시 평천로832번길 42',
    detailAddress: '4층',
  },
  returnAddress: {
    postalCode: '14521',
    roadAddress: '부천시 평천로832번길 42',
    detailAddress: '',
  },
  carrierAccountRef: 'HANJIN',
  supportedFulfillmentModes: ['in_house'],
  createdAt: '2026-09-26T00:00:00.000Z',
  updatedAt: '2026-09-26T00:00:00.000Z',
};

describe('emptyProfileForm', () => {
  it('자사 출고·in_house 를 기본값으로 둔다', () => {
    expect(emptyProfileForm().sourceType).toBe('in_house');
    expect(emptyProfileForm().modes).toEqual(['in_house']);
  });
});

describe('validateProfileForm', () => {
  it('완전하면 오류 없음', () => {
    expect(validateProfileForm(filled())).toEqual({});
  });
  it('필수 필드가 공백이면 오류', () => {
    const errors = validateProfileForm(
      filled({
        senderName: '  ',
        originRoadAddress: '',
        carrierAccountRef: ' ',
      })
    );
    expect(Object.keys(errors).sort()).toEqual([
      'carrierAccountRef',
      'originRoadAddress',
      'senderName',
    ]);
  });
  it('이행 방식이 없으면 오류', () => {
    expect(validateProfileForm(filled({ modes: [] }))).toHaveProperty('modes');
  });
  it('평균 배송일은 비우거나 0 이상 정수', () => {
    expect(validateProfileForm(filled({ avgDeliveryDays: '' }))).toEqual({});
    expect(validateProfileForm(filled({ avgDeliveryDays: '2' }))).toEqual({});
    expect(
      validateProfileForm(filled({ avgDeliveryDays: '-1' }))
    ).toHaveProperty('avgDeliveryDays');
    expect(
      validateProfileForm(filled({ avgDeliveryDays: '1.5' }))
    ).toHaveProperty('avgDeliveryDays');
  });
});

describe('toCreatePayload', () => {
  it('구조화 필드로 조립하고 공백을 다듬는다', () => {
    const payload = toCreatePayload(
      filled({ name: ' 부천 ', returnPhone: '' })
    );
    expect(payload.name).toBe('부천');
    expect(payload.sender).toEqual({ name: '엘씨나인', phone: '1877-7184' });
    expect(payload.returnAddress).toEqual({
      postalCode: '14521',
      roadAddress: '부천시 평천로832번길 42',
      detailAddress: '',
    });
    expect(payload.supportedFulfillmentModes).toEqual(['in_house']);
    expect(payload).not.toHaveProperty('avgDeliveryDays');
  });
  it('반품지 연락처·평균 배송일은 값이 있을 때만', () => {
    const payload = toCreatePayload(
      filled({ returnPhone: '010-1', avgDeliveryDays: '2' })
    );
    expect(payload.returnAddress.phone).toBe('010-1');
    expect(payload.avgDeliveryDays).toBe(2);
  });
});

describe('toUpdatePayload', () => {
  it('바뀐 게 없으면 빈 객체', () => {
    expect(toUpdatePayload(profile, formFromProfile(profile))).toEqual({});
  });
  it('중첩 객체는 한 필드만 바뀌어도 통째로 보낸다', () => {
    const payload = toUpdatePayload(profile, {
      ...formFromProfile(profile),
      senderPhone: '02-9',
    });
    expect(payload).toEqual({ sender: { name: '엘씨나인', phone: '02-9' } });
  });
  it('이름·계약번호·이행 방식 변경', () => {
    const payload = toUpdatePayload(profile, {
      ...formFromProfile(profile),
      name: '새 이름',
      carrierAccountRef: 'X',
      modes: ['in_house', '3pl'],
    });
    expect(payload).toEqual({
      name: '새 이름',
      carrierAccountRef: 'X',
      supportedFulfillmentModes: ['in_house', '3pl'],
    });
  });
  it('평균 배송일을 비우면 null(지우기)을 보낸다', () => {
    const withDays: DeliveryProfileDto = { ...profile, avgDeliveryDays: 3 };
    const payload = toUpdatePayload(withDays, {
      ...formFromProfile(withDays),
      avgDeliveryDays: '',
    });
    expect(payload).toEqual({ avgDeliveryDays: null });
  });
  it('평균 배송일이 원래 없었고 여전히 비어 있으면 바뀐 게 없다', () => {
    expect(
      toUpdatePayload(profile, {
        ...formFromProfile(profile),
        avgDeliveryDays: '',
      })
    ).toEqual({});
  });
});

describe('반품지·화주·복제', () => {
  it('반품지가 출고지와 같으면 출고지를 반품지로 보내고 반품지 칸은 검사하지 않는다', () => {
    const s = filled({
      returnSameAsOrigin: true,
      returnPostalCode: '',
      returnRoadAddress: '',
    });
    expect(validateProfileForm(s)).toEqual({});
    expect(toCreatePayload(s).returnAddress).toEqual(
      toCreatePayload(s).originAddress
    );
  });

  it('반품지를 따로 쓰면 반품지 칸이 필수다', () => {
    const errors = validateProfileForm(
      filled({ returnPostalCode: '', returnRoadAddress: '' })
    );
    expect(Object.keys(errors).sort()).toEqual([
      'returnPostalCode',
      'returnRoadAddress',
    ]);
  });

  it('반품지가 출고지와 같은 프로필을 열면 체크된 채로 연다', () => {
    const same = { ...profile, returnAddress: { ...profile.originAddress } };
    expect(formFromProfile(same).returnSameAsOrigin).toBe(true);
    expect(formFromProfile(profile).returnSameAsOrigin).toBe(false);
  });

  it('화주를 고르면 생성·수정에 화주 ID 를 싣는다', () => {
    expect(toCreatePayload(filled({ holderId: 'h1' })).holderId).toBe('h1');
    expect('holderId' in toCreatePayload(filled())).toBe(false);
    expect(
      toUpdatePayload(profile, { ...formFromProfile(profile), holderId: 'h1' })
    ).toEqual({ holderId: 'h1' });
  });

  it('복제는 이름에 사본을 붙이고 나머지 값을 그대로 쓴다', () => {
    const copy = copiedProfileForm({ ...profile, holderId: 'h1' });
    expect(copy.name).toBe('부천 자사 출고 사본');
    expect(copy.holderId).toBe('h1');
    expect(copy.senderName).toBe('엘씨나인');
  });
});
