import type { DeliveryProfile } from '../../schema/inventory.schema';
import { DeliveryProfileMapper } from './delivery-profile.mapper';

function row(overrides: Partial<DeliveryProfile> = {}): DeliveryProfile {
  return {
    id: 'p1',
    name: 'n',
    sourceType: 'in_house',
    avgDeliveryDays: null,
    senderSnapshot: { name: 'S', phone: '02' },
    originAddressSnapshot: { postalCode: '1', roadAddress: 'R', detailAddress: 'D' },
    returnAddressSnapshot: { postalCode: '2', roadAddress: 'R2', detailAddress: '', phone: '010' },
    carrierAccountRef: 'C',
    supportedFulfillmentModes: ['in_house'],
    handlingFlags: null,
    createdAt: new Date('2026-09-26T00:00:00Z'),
    updatedAt: new Date('2026-09-26T00:00:00Z'),
    ...overrides,
  };
}

describe('DeliveryProfileMapper.toDto', () => {
  it('jsonb 스냅샷을 구조화 필드로 낸다', () => {
    const dto = DeliveryProfileMapper.toDto(row(), 3);
    expect(dto.sender).toEqual({ name: 'S', phone: '02' });
    expect(dto.originAddress).toEqual({ postalCode: '1', roadAddress: 'R', detailAddress: 'D' });
    expect(dto.returnAddress).toEqual({ postalCode: '2', roadAddress: 'R2', detailAddress: '', phone: '010' });
    expect(dto.skuCount).toBe(3);
    expect(dto.createdAt).toBe('2026-09-26T00:00:00.000Z');
  });
  // 데모 시드·픽스처의 옛 모양. 목록 API 가 죽으면 안 된다.
  it('옛 모양 스냅샷도 빈 문자열로 정규화한다', () => {
    const dto = DeliveryProfileMapper.toDto(
      row({
        originAddressSnapshot: { address: 'Origin' },
        returnAddressSnapshot: null,
        senderSnapshot: null,
        supportedFulfillmentModes: null,
      }),
    );
    expect(dto.originAddress).toEqual({ postalCode: '', roadAddress: '', detailAddress: '' });
    expect(dto.returnAddress).toEqual({ postalCode: '', roadAddress: '', detailAddress: '' });
    expect(dto.sender).toEqual({ name: '', phone: '' });
    expect(dto.supportedFulfillmentModes).toEqual([]);
    expect(dto.skuCount).toBeUndefined();
  });
});

describe('DeliveryProfileMapper.toColumns', () => {
  it('DTO 를 테이블 컬럼으로 옮기고, 보내지 않은 필드는 만들지 않는다', () => {
    expect(DeliveryProfileMapper.toColumns({ name: 'x', sender: { name: 'a', phone: 'b' } })).toEqual({
      name: 'x',
      senderSnapshot: { name: 'a', phone: 'b' },
    });
  });
  it('반품지 phone 이 비면 저장하지 않는다', () => {
    expect(
      DeliveryProfileMapper.toColumns({
        returnAddress: { postalCode: '1', roadAddress: 'R', detailAddress: '', phone: '' },
      }),
    ).toEqual({ returnAddressSnapshot: { postalCode: '1', roadAddress: 'R', detailAddress: '' } });
  });
});
