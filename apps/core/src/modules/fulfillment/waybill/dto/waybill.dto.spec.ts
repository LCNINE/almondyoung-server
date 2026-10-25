import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { IssueBatchWaybillDto, IssueWaybillDto, RegisterManualWaybillDto } from './waybill.dto';

/** 송장 DTO 셋은 carrier enum 14개를 받는다(K3 PR 5, N11) — 발급은 게이트웨이 레지스트리가 모르는 택배사를 거절한다 */
describe('waybill DTO carrier', () => {
  const carrierErrors = async (cls: new () => object, body: object) =>
    (await validate(plainToInstance(cls, body))).filter((e) => e.property === 'carrier').length;

  it('수기 송장은 EPOST·HANJIN 을 받고 NOPE 는 거절한다', async () => {
    const base = { expectedManifestVersion: 1, trackingNo: '1' };
    expect(await carrierErrors(RegisterManualWaybillDto, { ...base, carrier: 'EPOST' })).toBe(0);
    expect(await carrierErrors(RegisterManualWaybillDto, { ...base, carrier: 'HANJIN' })).toBe(0);
    expect(await carrierErrors(RegisterManualWaybillDto, { ...base, carrier: 'NOPE' })).toBe(1);
  });

  it('발급·일괄 발급도 EPOST 를 받고 NOPE 는 거절한다', async () => {
    expect(await carrierErrors(IssueWaybillDto, { expectedManifestVersion: 1, carrier: 'EPOST' })).toBe(0);
    expect(await carrierErrors(IssueWaybillDto, { expectedManifestVersion: 1, carrier: 'NOPE' })).toBe(1);
    expect(await carrierErrors(IssueBatchWaybillDto, { shipmentIds: ['a'], carrier: 'EPOST' })).toBe(0);
    expect(await carrierErrors(IssueBatchWaybillDto, { shipmentIds: ['a'], carrier: 'NOPE' })).toBe(1);
  });
});
