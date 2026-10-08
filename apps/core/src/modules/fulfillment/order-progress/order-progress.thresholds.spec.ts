import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  directShipStatusEnum,
  exchangeRequestStatusEnum,
  fulfillmentOrderCreationBacklogStatusEnum,
  outboundBatchWorkItemStatusEnum,
  returnRequestStatusEnum,
  shipmentStatusEnum,
  waybillStatusEnum,
} from '../../inventory/schema/inventory.schema';
import { judgedRowsSql } from './order-progress.judge-sql';
import {
  ORDER_PROGRESS_STAGES,
  ORDER_PROGRESS_STATES,
  OrderProgressStage,
  STUCK_AFTER_MS,
  isStuck,
  stuckCutoff,
} from './order-progress.thresholds';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe('order-progress thresholds', () => {
  it('스펙 §6 표의 기준을 그대로 갖는다', () => {
    expect(STUCK_AFTER_MS).toEqual({
      accept: HOUR,
      fo: DAY,
      reserve: 3 * DAY,
      plan: DAY,
      waybill: HOUR,
      pick: 12 * HOUR,
      dispatch: HOUR,
      track: 5 * DAY,
      cancel_request: 5 * 60_000,
      cancel: HOUR,
      return_exchange: 7 * DAY,
      unclassified: 0,
    });
  });

  it('모든 단계에 기준이 있다', () => {
    for (const stage of ORDER_PROGRESS_STAGES) expect(typeof STUCK_AFTER_MS[stage]).toBe('number');
  });

  it('기준을 «넘겨야» 갇힘이다 — 같으면 아니다', () => {
    const now = new Date('2026-10-06T12:00:00.000Z');
    expect(isStuck('accept', new Date(now.getTime() - HOUR), now)).toBe(false);
    expect(isStuck('accept', new Date(now.getTime() - HOUR - 1), now)).toBe(true);
  });

  it('unclassified 는 들어온 순간부터 갇힘이다', () => {
    const now = new Date('2026-10-06T12:00:00.000Z');
    expect(isStuck('unclassified', new Date(now.getTime() - 1), now)).toBe(true);
  });

  it('stuckCutoff 는 now − 기준', () => {
    const now = new Date('2026-10-06T12:00:00.000Z');
    expect(stuckCutoff('fo', now).toISOString()).toBe('2026-10-05T12:00:00.000Z');
  });
});

describe('ORDER_PROGRESS_STATES', () => {
  // 판정 SQL 의 본문. 리터럴 세부 상태는 여기에 따옴표째로 들어 있다
  const judgeText = new PgDialect().sqlToQuery(judgedRowsSql(sql`SELECT NULL::uuid`, '2000-01-01T00:00:00.000Z')).sql;
  const dropShip = directShipStatusEnum.enumValues.map((v) => `drop_ship_${v}`);
  // 판정 SQL 이 원천 값을 그대로(또는 접두어를 붙여) 내는 단계 — 그 단계의 세부 상태는 원천 enum 값이어야 한다
  const passthrough: Partial<Record<OrderProgressStage, readonly string[]>> = {
    fo: fulfillmentOrderCreationBacklogStatusEnum.enumValues,
    waybill: waybillStatusEnum.enumValues,
    pick: outboundBatchWorkItemStatusEnum.enumValues,
    track: [...shipmentStatusEnum.enumValues, ...dropShip],
    dispatch: dropShip,
    return_exchange: [
      ...returnRequestStatusEnum.enumValues.map((v) => `return:${v}`),
      ...exchangeRequestStatusEnum.enumValues.map((v) => `exchange:${v}`),
    ],
  };

  it.each([...ORDER_PROGRESS_STAGES])('%s 의 세부 상태는 판정 SQL 이 실제로 낼 수 있는 값이다', (stage) => {
    const unknown = ORDER_PROGRESS_STATES[stage].filter(
      (state) => !judgeText.includes(`'${state}'`) && !(passthrough[stage] ?? []).includes(state),
    );
    // 오타가 섞이면 그 칸을 겨눈 규칙은 영원히 후보가 없고, deleteDeparted 가 그 규칙의 행을 조용히 지운다
    expect(unknown).toEqual([]);
  });

  it('12번 규칙의 칸(fo/awaiting_matching)이 어휘에 있다', () => {
    expect(ORDER_PROGRESS_STATES.fo).toContain('awaiting_matching');
  });
});
