import type { Carrier } from '@packages/event-contracts/streams/fulfillments.stream';
import type { ShipmentCarrier } from '@packages/event-contracts/streams/shipments.stream';
import { carrierEnum } from '../../../inventory/schema/inventory.schema';
import {
  EVENT_CONTRACT_CARRIERS,
  isEventContractCarrier,
  type EventContractCarrier,
} from './carrier-gateway.interface';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
// type-check 가 판정한다 — 계약 zod 의 택배사와 창고 경로가 내는 택배사가 갈리면 컴파일이 깨진다(K3 PR 3 이 함께 넓힌다)
const sameAsShipments: Equal<EventContractCarrier, ShipmentCarrier> = true;
const sameAsFulfillments: Equal<EventContractCarrier, Carrier> = true;

const SUPPLIER_CARRIERS = ['EPOST', 'DAESIN', 'ILYANG', 'HDEXP', 'CVSNET', 'CUPOST', 'CHUNIL', 'KUNYOUNG'];

describe('EVENT_CONTRACT_CARRIERS (K3 PR 2, N5)', () => {
  it('계약 타입과 같다', () => {
    expect(sameAsShipments && sameAsFulfillments).toBe(true);
  });

  it('carrier enum 의 부분집합이고, enum 은 입점사 택배사 8개를 모두 갖는다', () => {
    const values: readonly string[] = carrierEnum.enumValues;
    expect(EVENT_CONTRACT_CARRIERS.every((c) => values.includes(c))).toBe(true);
    expect(SUPPLIER_CARRIERS.filter((c) => !values.includes(c))).toEqual([]);
  });

  it('입점사 택배사는 계약 밖이다', () => {
    expect(isEventContractCarrier('HANJIN')).toBe(true);
    expect(SUPPLIER_CARRIERS.filter((c) => isEventContractCarrier(c as never))).toEqual([]);
  });
});
