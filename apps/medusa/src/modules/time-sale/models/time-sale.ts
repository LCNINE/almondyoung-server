import { model } from '@medusajs/framework/utils';

/**
 * 타임세일 한 건. 기간·상태의 정본이고, 가격은 링크된 price list(일반용 1 + 멤버십용 0~1)에 있다.
 *
 * price list 에는 metadata 가 없어 짝을 묶을 자리가 없었다 — 그래서 한때 «제목 + 시작 시각» 으로
 * 짝을 맞췄고, 수정이 중간에 멈추자 세일이 둘로 갈렸다(2026-10-09 사고). 짝은 이 행과의 링크다.
 *
 * `title` 은 어드민 전용이다. 고객 응답에 싣지 않는다.
 */
const TimeSale = model.define(
  { name: 'TimeSale', tableName: 'time_sale' },
  {
    id: model.id({ prefix: 'tsale' }).primaryKey(),
    title: model.text(),
    starts_at: model.dateTime(),
    ends_at: model.dateTime(),
    // draft 는 연결된 price list 도 draft 라 가격 계산에서 빠진다 — 고객에게 안 보인다.
    status: model.enum(['draft', 'active']).default('draft'),
  },
);

export default TimeSale;
