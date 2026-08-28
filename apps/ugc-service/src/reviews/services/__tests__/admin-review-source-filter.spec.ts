/**
 * 관리자 리뷰 목록의 출처 필터 — 이전 사이트 이관분과 자체 작성분을 갈라 센다.
 *
 * 어드민 메인의 '미답변 리뷰' 칩이 이 필터를 건다. 필터가 빠지면 칩이 이관 백로그까지
 * 세어 "오늘 처리할 일" 자리에 수만 건이 뜬다.
 */

describe('ReviewsService.listAllForAdmin — source 필터', () => {
  /** 캡처한 where 절에서 참조된 컬럼명과 연산자 문자열을 전부 모은다 */
  function collectSql(node: unknown, out: { columns: string[]; operators: string[] }) {
    if (typeof node === 'string') {
      const trimmed = node.trim();
      if (trimmed) out.operators.push(trimmed);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    if (typeof record.name === 'string' && typeof record.columnType === 'string') {
      out.columns.push(record.name);
    }
    // drizzle 은 연산자를 StringChunk({ value: [' = '] }) 로 감싼다
    if (Array.isArray(record.value)) {
      for (const part of record.value) collectSql(part, out);
    }
    const children = Array.isArray(node) ? node : (record.queryChunks as unknown[] | undefined);
    if (Array.isArray(children)) {
      for (const child of children) collectSql(child, out);
    }
  }

  async function runQuery(query: Record<string, unknown>) {
    const { ReviewsService } = await import('../reviews.service');

    const whereClauses: unknown[] = [];
    // hasComment 필터의 notExists 서브쿼리도 tx.select 를 부르지만 await 되지 않는다.
    // 그래서 select 호출이 아니라 실제로 await 된 순서로 응답을 고른다.
    let awaited = 0;
    const selectChain = () => {
      const chain: Record<string, unknown> = {
        from: () => chain,
        where: (clause: unknown) => {
          whereClauses.push(clause);
          return chain;
        },
        orderBy: () => chain,
        limit: () => chain,
        offset: () => chain,
        then: (resolve: (value: unknown) => unknown) =>
          // 첫 await 는 count(), 그 뒤(목록·미디어·반응·댓글)는 빈 결과
          Promise.resolve(awaited++ === 0 ? [{ count: 0 }] : []).then(resolve),
      };
      return chain;
    };

    const tx = { select: () => selectChain() };

    const dbService = { db: { transaction: (fn: (t: unknown) => unknown) => fn(tx) } } as never;
    const service = new ReviewsService(
      dbService,
      { calculateReward: jest.fn() } as never,
      { publishEarnPointsCommand: jest.fn() } as never,
      { publishProductReviewStatsChanged: jest.fn() } as never,
      { get: jest.fn() } as never,
    );

    await service.listAllForAdmin(query as never);

    const collected = { columns: [] as string[], operators: [] as string[] };
    for (const clause of whereClauses) collectSql(clause, collected);
    return collected;
  }

  it('source 미지정이면 source_system 조건을 걸지 않는다 (기존 동작 보존)', async () => {
    const { columns } = await runQuery({ hasComment: 'false', status: 'active' });
    expect(columns).not.toContain('source_system');
  });

  it("source='own' 이면 source_system 을 같음으로 건다", async () => {
    const { columns, operators } = await runQuery({ hasComment: 'false', source: 'own' });
    expect(columns).toContain('source_system');
    expect(operators).toContain('=');
    expect(operators).not.toContain('<>');
  });

  it("source='legacy' 이면 source_system 을 다름으로 건다", async () => {
    const { columns, operators } = await runQuery({ hasComment: 'false', source: 'legacy' });
    expect(columns).toContain('source_system');
    expect(operators).toContain('<>');
  });
});
