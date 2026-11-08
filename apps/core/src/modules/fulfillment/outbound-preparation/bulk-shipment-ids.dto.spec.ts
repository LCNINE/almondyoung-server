import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { BulkShipmentIdsDto } from '../dto/outbound-preparation.dto';

describe('BulkShipmentIdsDto', () => {
  const uuid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  it.each([1, 100])('accepts %i UUID v4 shipment IDs', (count) => {
    const dto = plainToInstance(BulkShipmentIdsDto, { shipmentIds: Array(count).fill(uuid) });

    expect(validateSync(dto)).toEqual([]);
  });

  it.each([
    { shipmentIds: [] },
    { shipmentIds: Array(101).fill(uuid) },
    { shipmentIds: [uuid, 'invalid'] },
    { shipmentIds: ['aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaaaa'] },
    { shipmentIds: uuid },
    {},
  ])('rejects invalid input: %j', (input) => {
    const dto = plainToInstance(BulkShipmentIdsDto, input);

    expect(validateSync(dto).map((error) => error.property)).toEqual(['shipmentIds']);
  });
});
