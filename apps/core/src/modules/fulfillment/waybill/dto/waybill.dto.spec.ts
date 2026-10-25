import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { IssueBatchWaybillDto, IssueWaybillDto, RegisterManualWaybillDto } from './waybill.dto';

/** 창고 상자의 송장은 이벤트 계약이 받는 택배사만 — 입점사 택배사로 발송하면 소비자 zod 가 throw 한다(K3 PR 2, N5) */
describe('waybill DTO carrier', () => {
  const carrierErrors = async (cls: new () => object, body: object) =>
    (await validate(plainToInstance(cls, body))).filter((e) => e.property === 'carrier').length;

  it('수기 송장은 EPOST 를 거절하고 HANJIN 은 받는다', async () => {
    const base = { expectedManifestVersion: 1, trackingNo: '1' };
    expect(await carrierErrors(RegisterManualWaybillDto, { ...base, carrier: 'EPOST' })).toBe(1);
    expect(await carrierErrors(RegisterManualWaybillDto, { ...base, carrier: 'HANJIN' })).toBe(0);
  });

  it('발급·일괄 발급도 EPOST 를 거절한다', async () => {
    expect(await carrierErrors(IssueWaybillDto, { expectedManifestVersion: 1, carrier: 'EPOST' })).toBe(1);
    expect(await carrierErrors(IssueBatchWaybillDto, { shipmentIds: ['a'], carrier: 'EPOST' })).toBe(1);
  });
});
