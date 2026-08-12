import { findDirectPriceRuleViolations } from '../catalog-price-list-guard';

const MEMBERSHIP_GROUP_ID = 'cusgroup_membership';

describe('findDirectPriceRuleViolations', () => {
  const knexReturning = (rows: Array<{ group_id: string; rule_count: string | number }>) => {
    const raw = jest.fn().mockResolvedValue({ rows });
    return { knex: { raw }, raw };
  };

  it('멤버십 외 고객 그룹으로 가격이 갈리면 잡는다', async () => {
    // price list 를 안 거치고 price 에 직접 단 룰. pricing 모듈은 이것도 컨텍스트와 대조하므로
    // "두 벌이면 전부 표현된다" 는 전제가 여기서도 깨진다.
    const { knex } = knexReturning([{ group_id: 'cusgroup_vip', rule_count: '3' }]);

    const violations = await findDirectPriceRuleViolations(knex, MEMBERSHIP_GROUP_ID);

    expect(violations).toEqual([{ groupId: 'cusgroup_vip', ruleCount: 3 }]);
  });

  it('멤버십 그룹과 삭제된 룰은 조회 단계에서 뺀다', async () => {
    const { knex, raw } = knexReturning([]);

    await findDirectPriceRuleViolations(knex, MEMBERSHIP_GROUP_ID);

    const [sql, bindings] = raw.mock.calls[0];
    expect(sql).toContain('deleted_at IS NULL');
    expect(sql).toContain('pr.value <> ?');
    expect(bindings).toEqual(['customer.groups.id', MEMBERSHIP_GROUP_ID]);
  });

  it('rows 가 없어도 터지지 않는다', async () => {
    const knex = { raw: jest.fn().mockResolvedValue({}) };

    await expect(findDirectPriceRuleViolations(knex, MEMBERSHIP_GROUP_ID)).resolves.toEqual([]);
  });
});
