import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { carrierEnum } from '../../../inventory/schema/inventory.schema';
import { RegisterManualWaybillDto } from '../dto/waybill.dto';
import { CARRIER_NAME_BY_CODE, parseCarrierName } from './carrier-names';

describe('parseCarrierName (K3 PR5, N11)', () => {
  it.each(['우체국', '우체국택배', 'epost', ' EPOST ', 'ep ost'])('%j → EPOST', (raw) => {
    expect(parseCarrierName(raw)).toBe('EPOST');
  });

  it('CJ 대한통운 → CJ', () => {
    expect(parseCarrierName('CJ 대한통운')).toBe('CJ');
  });

  it('CARRIER_NAME_BY_CODE 의 14개 이름이 전부 자기 코드로 돌아온다', () => {
    const entries = Object.entries(CARRIER_NAME_BY_CODE);
    expect(entries).toHaveLength(carrierEnum.enumValues.length);
    for (const [code, name] of entries) expect(parseCarrierName(name)).toBe(code);
  });

  it.each(['없는택배', ''])('%j → null', (raw) => {
    expect(parseCarrierName(raw)).toBeNull();
  });
});

describe('RegisterManualWaybillDto 택배사', () => {
  const run = (carrier: string) =>
    validate(plainToInstance(RegisterManualWaybillDto, { expectedManifestVersion: 1, carrier, trackingNo: '1' }));

  it('EPOST 는 받는다', async () => {
    expect(await run('EPOST')).toHaveLength(0);
  });
  it('NOPE 는 거절한다', async () => {
    expect(await run('NOPE')).toHaveLength(1);
  });
});
