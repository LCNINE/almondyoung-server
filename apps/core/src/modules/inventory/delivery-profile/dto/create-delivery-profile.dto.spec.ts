import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateDeliveryProfileDto } from './create-delivery-profile.dto';
import { UpdateDeliveryProfileDto } from './update-delivery-profile.dto';

const valid = {
  name: '부천 자사 출고',
  sourceType: 'in_house',
  sender: { name: '엘씨나인', phone: '1877-7184' },
  originAddress: { postalCode: '14521', roadAddress: '경기도 부천시 평천로832번길 42', detailAddress: '4층' },
  returnAddress: { postalCode: '14521', roadAddress: '경기도 부천시 평천로832번길 42', detailAddress: '4층' },
  carrierAccountRef: 'HANJIN',
  supportedFulfillmentModes: ['in_house'],
};

async function errorsOf(cls: typeof CreateDeliveryProfileDto | typeof UpdateDeliveryProfileDto, body: object) {
  const errors = await validate(plainToInstance(cls, body), { whitelist: true });
  return errors.map((e) => e.property);
}

describe('CreateDeliveryProfileDto', () => {
  it('완전한 입력을 받는다', async () => {
    expect(await errorsOf(CreateDeliveryProfileDto, valid)).toEqual([]);
  });
  it('detailAddress 는 빈 문자열을 허용한다', async () => {
    expect(
      await errorsOf(CreateDeliveryProfileDto, {
        ...valid,
        originAddress: { ...valid.originAddress, detailAddress: '' },
      }),
    ).toEqual([]);
  });
  it.each([
    'name',
    'sourceType',
    'sender',
    'originAddress',
    'returnAddress',
    'carrierAccountRef',
    'supportedFulfillmentModes',
  ])('%s 가 없으면 거부', async (key) => {
    const body: Record<string, unknown> = { ...valid };
    delete body[key];
    expect(await errorsOf(CreateDeliveryProfileDto, body)).toContain(key);
  });
  it('공백뿐인 발송인 이름·전화·계약번호를 거부', async () => {
    expect(await errorsOf(CreateDeliveryProfileDto, { ...valid, sender: { name: '  ', phone: '1' } })).toContain(
      'sender',
    );
    expect(await errorsOf(CreateDeliveryProfileDto, { ...valid, sender: { name: 'a', phone: ' ' } })).toContain(
      'sender',
    );
    expect(await errorsOf(CreateDeliveryProfileDto, { ...valid, carrierAccountRef: '   ' })).toContain(
      'carrierAccountRef',
    );
  });
  it('주소 postalCode·roadAddress 가 비면 거부', async () => {
    expect(
      await errorsOf(CreateDeliveryProfileDto, {
        ...valid,
        originAddress: { ...valid.originAddress, roadAddress: '' },
      }),
    ).toContain('originAddress');
  });
  it('이행 방식은 1개 이상·중복 없음·enum 값만', async () => {
    expect(await errorsOf(CreateDeliveryProfileDto, { ...valid, supportedFulfillmentModes: [] })).toContain(
      'supportedFulfillmentModes',
    );
    expect(
      await errorsOf(CreateDeliveryProfileDto, { ...valid, supportedFulfillmentModes: ['in_house', 'in_house'] }),
    ).toContain('supportedFulfillmentModes');
    expect(await errorsOf(CreateDeliveryProfileDto, { ...valid, supportedFulfillmentModes: ['courier'] })).toContain(
      'supportedFulfillmentModes',
    );
  });
  it('잘못된 sourceType 을 거부', async () => {
    expect(await errorsOf(CreateDeliveryProfileDto, { ...valid, sourceType: 'partner' })).toContain('sourceType');
  });
});

describe('UpdateDeliveryProfileDto', () => {
  it('빈 객체를 받는다', async () => {
    expect(await errorsOf(UpdateDeliveryProfileDto, {})).toEqual([]);
  });
  // 완전한 프로필을 PATCH 로 불완전하게 만들면 계획 확정이 다시 막힌다
  it('보낸 중첩 객체는 통째로 검증한다 — 빈 발송인 이름을 거부', async () => {
    expect(await errorsOf(UpdateDeliveryProfileDto, { sender: { name: '', phone: '1' } })).toContain('sender');
  });
  it('빈 계약번호를 거부', async () => {
    expect(await errorsOf(UpdateDeliveryProfileDto, { carrierAccountRef: '' })).toContain('carrierAccountRef');
  });

  // I-1: `@IsOptional()` 은 null 도 "안 보냄"으로 보고 검증을 건너뛴다. PartialType 이
  // skipNullProperties:false 로 null 은 각 필드 검증기를 타게 해야 아래가 전부 거부된다.
  it.each(['name', 'sourceType', 'sender', 'originAddress', 'returnAddress', 'carrierAccountRef'])(
    '%s 에 null 을 보내면 거부',
    async (key) => {
      expect(await errorsOf(UpdateDeliveryProfileDto, { [key]: null })).toContain(key);
    },
  );
  it('supportedFulfillmentModes 에 null 을 보내면 거부', async () => {
    expect(await errorsOf(UpdateDeliveryProfileDto, { supportedFulfillmentModes: null })).toContain(
      'supportedFulfillmentModes',
    );
  });
  it('avgDeliveryDays 는 null 을 허용한다 — 값 지우기', async () => {
    expect(await errorsOf(UpdateDeliveryProfileDto, { avgDeliveryDays: null })).toEqual([]);
  });
});
