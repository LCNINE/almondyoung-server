import { z } from '@medusajs/framework/zod';
import { META_KEYS } from '../helpers';
import {
  promotionAdditionalDataCreateShape,
  promotionAdditionalDataUpdateShape,
} from '../additional-data-schema';

/**
 * 프레임워크는 이 shape 을 `z.object(shape).nullish()` 로 감싼다
 * (`@medusajs/framework/dist/http/middleware-file-loader.js:153`). `z.object` 기본이 **strip** 이라
 * 스키마에 없는 키는 400 이 아니라 **조용히 버려지고 훅까지 못 간다**(2026-08-31 실측).
 * 그래서 「키 집합이 META_KEYS 를 덮는가」가 실제 방어선이다.
 */
describe('additional_data 스키마', () => {
  it('생성·수정 둘 다 META_KEYS 를 전부 받는다 — 빠지면 그 값은 조용히 사라진다', () => {
    expect(Object.keys(promotionAdditionalDataCreateShape).sort()).toEqual([...META_KEYS].sort());
    expect(Object.keys(promotionAdditionalDataUpdateShape).sort()).toEqual([...META_KEYS].sort());
  });

  it('생성은 visibility 를 요구하고 어휘 밖 값을 거부한다', () => {
    const schema = z.object(promotionAdditionalDataCreateShape);
    expect(schema.safeParse({ visibility: 'assigned_only' }).success).toBe(true);
    expect(schema.safeParse({ visibility: 'bogus_value' }).success).toBe(false);
    expect(schema.safeParse({ name: '이름만' }).success).toBe(false);
  });

  it('수정은 부분 갱신이라 visibility 없이도 통과한다 — 상태 토글이 400 나면 안 된다', () => {
    const schema = z.object(promotionAdditionalDataUpdateShape);
    expect(schema.safeParse({ name: '새 이름' }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ visibility: 'bogus_value' }).success).toBe(false);
  });

  it('auto_issue_trigger 어휘도 닫혀 있다', () => {
    const schema = z.object(promotionAdditionalDataUpdateShape);
    expect(schema.safeParse({ auto_issue_trigger: 'customer_registered' }).success).toBe(true);
    expect(schema.safeParse({ auto_issue_trigger: 'never_heard_of_it' }).success).toBe(false);
  });

  it('max_claims 는 양의 정수만 받는다', () => {
    const schema = z.object(promotionAdditionalDataUpdateShape);
    expect(schema.safeParse({ max_claims: 100 }).success).toBe(true);
    expect(schema.safeParse({ max_claims: 0 }).success).toBe(false);
    expect(schema.safeParse({ max_claims: 1.5 }).success).toBe(false);
  });

  it('유효기간 3키를 받는다', () => {
    const schema = z.object(promotionAdditionalDataUpdateShape);
    expect(schema.safeParse({ starts_at: '2026-09-01T00:00:00.000Z' }).success).toBe(true);
    expect(schema.safeParse({ ends_at: '2026-09-30T00:00:00.000Z' }).success).toBe(true);
    expect(schema.safeParse({ validity_days: 30 }).success).toBe(true);
  });

  it('validity_days 는 양의 정수만, 날짜는 파싱 가능한 문자열만 받는다', () => {
    const schema = z.object(promotionAdditionalDataUpdateShape);
    expect(schema.safeParse({ validity_days: 0 }).success).toBe(false);
    expect(schema.safeParse({ validity_days: 1.5 }).success).toBe(false);
    expect(schema.safeParse({ ends_at: '언젠가' }).success).toBe(false);
  });
});
