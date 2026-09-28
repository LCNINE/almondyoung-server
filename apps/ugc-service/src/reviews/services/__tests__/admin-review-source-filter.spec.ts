describe('ReviewsService.listAllForAdmin — source 필터', () => {
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
    if (typeof record.value === 'string') collectSql(record.value, out);
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
    // 서브쿼리 구성 호출은 제외하고 await 순서로 응답한다.
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
      { consume: jest.fn(), linkConsumedReview: jest.fn() } as never,
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
  it.each(['order', 'admin'])('provider=%s uses permission linkage, independently of source', async (provider) => {
    const { columns, operators } = await runQuery({ provider });
    expect(columns).toContain('provider');
    expect(columns).toContain('review_permission_id');
    expect(columns).not.toContain('source_system');
    expect(operators).toContain(provider);
  });

  it('unassigned only matches reviews without a permission', async () => {
    const { columns, operators } = await runQuery({ provider: 'unassigned' });
    expect(columns).toContain('review_permission_id');
    expect(columns).not.toContain('provider');
    expect(operators.join(' ')).toContain('is null');
  });

  it('batch filter also applies with status and source filters', async () => {
    const { columns, operators } = await runQuery({
      provider: 'admin',
      batchId: 'test-batch',
      status: 'hidden',
      source: 'own',
    });
    expect(columns).toEqual(expect.arrayContaining(['batch_id', 'provider', 'status', 'source_system']));
    expect(operators).toContain('test-batch');
  });
  it.each(['true', 'false'])(
    'hasMedia=%s filters count and rows with a correlated media subquery',
    async (hasMedia) => {
      const { columns, operators } = await runQuery({ hasMedia, provider: 'admin', status: 'hidden' });
      expect(columns).toContain('review_id');
      expect(columns).toContain('provider');
      expect(columns).toContain('status');
      const text = operators.join(' ');
      expect(text).toContain(hasMedia === 'true' ? 'exists' : 'not exists');
      if (hasMedia === 'true') expect(text).not.toContain('not exists');
    },
  );
});
