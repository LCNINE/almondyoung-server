/**
 * 이벤트 계약이 받는 택배사 코드. `shipments.stream.ts`·`fulfillments.stream.ts` 가 함께 쓴다.
 *
 * core DB enum(`carrierEnum`, inventory.schema.ts)과 같은 순서·같은 값이어야 한다 — core 의
 * `carrier-contract-equality.spec.ts` 가 type-check 로 지킨다. 뒤의 8개는 입점사 상자 수기 송장용(K3).
 * 소비자는 모르는 값이면 zod 가 throw 하므로 값을 더할 때는 소비자가 먼저 라이브여야 한다.
 */
export const CARRIERS = [
  'CJ',
  'HANJIN',
  'LOTTE',
  'LOGEN',
  'KDEXP',
  'CJGLS',
  'EPOST',
  'DAESIN',
  'ILYANG',
  'HDEXP',
  'CVSNET',
  'CUPOST',
  'CHUNIL',
  'KUNYOUNG',
] as const;

export type Carrier = (typeof CARRIERS)[number];
