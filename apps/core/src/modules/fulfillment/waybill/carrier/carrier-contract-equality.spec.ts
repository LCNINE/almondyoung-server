import { CARRIERS, type Carrier } from '@packages/event-contracts/streams/fulfillments.stream';
import type { ShipmentCarrier } from '@packages/event-contracts/streams/shipments.stream';
import { carrierEnum } from '../../../inventory/schema/inventory.schema';
import type { CarrierCode } from './carrier-gateway.interface';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
// type-check 가 판정한다 — DB enum 과 계약 택배사가 갈리면 컴파일이 깨진다
const dbEqualsShipments: Equal<CarrierCode, ShipmentCarrier> = true;
const dbEqualsFulfillments: Equal<CarrierCode, Carrier> = true;

describe('택배사 목록 (K3 PR 3·5, E1·E3)', () => {
  it('DB enum 과 계약이 같은 14개다', () => {
    expect(dbEqualsShipments && dbEqualsFulfillments).toBe(true);
    expect([...carrierEnum.enumValues]).toEqual([...CARRIERS]);
  });
});
