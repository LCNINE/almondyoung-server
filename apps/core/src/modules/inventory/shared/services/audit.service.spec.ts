import { AuditService, type AuditLogData } from './audit.service';

describe('AuditService required audit', () => {
  const auditData: AuditLogData = {
    eventType: 'USER_ACTION',
    action: 'force_dispatch',
    module: 'fulfillment',
    description: 'Force shipment dispatch',
  };

  function insertTarget(values: jest.Mock) {
    return { insert: jest.fn(() => ({ values })) };
  }

  it('writes through the caller transaction and records the JWT actor, not a forged body actor', async () => {
    const defaultValues = jest.fn();
    const transactionValues = jest.fn().mockResolvedValue(undefined);
    const service = new AuditService({ db: insertTarget(defaultValues) } as never);
    const tx = insertTarget(transactionValues);

    await service.logUserActionRequired(
      'force_dispatch',
      'fulfillment',
      'Force shipment dispatch',
      { userId: 'jwt-actor', correlationId: 'request-1' },
      { requestBody: { operatorId: 'forged-body-actor' } },
      tx as never,
    );

    expect(defaultValues).not.toHaveBeenCalled();
    expect(transactionValues).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'USER_ACTION',
        action: 'force_dispatch',
        userId: 'jwt-actor',
        correlationId: 'request-1',
        metadata: { requestBody: { operatorId: 'forged-body-actor' } },
      }),
    );
  });

  it('propagates database errors from required audit so the domain transaction rolls back', async () => {
    const failure = new Error('audit database unavailable');
    const transactionValues = jest.fn().mockRejectedValue(failure);
    const service = new AuditService({ db: insertTarget(jest.fn()) } as never);

    await expect(
      service.logRequired(auditData, { userId: 'jwt-actor' }, insertTarget(transactionValues) as never),
    ).rejects.toBe(failure);
  });

  it('rejects required audit without a caller-owned transaction', async () => {
    const defaultValues = jest.fn();
    const service = new AuditService({ db: insertTarget(defaultValues) } as never);

    await expect(service.logRequired(auditData, { userId: 'jwt-actor' }, undefined as never)).rejects.toThrow(
      'AuditService.logRequired requires the caller transaction',
    );
    expect(defaultValues).not.toHaveBeenCalled();
  });

  it('keeps legacy log best-effort and swallows database failures', async () => {
    const defaultValues = jest.fn().mockRejectedValue(new Error('legacy audit failure'));
    const service = new AuditService({ db: insertTarget(defaultValues) } as never);

    await expect(service.log(auditData, { userId: 'legacy-actor' })).resolves.toBeUndefined();
  });

  /**
   * #744 — `timestamp` 는 «진짜 순간»이어야 한다.
   *
   * `nowSeoul()` 은 표시용 벽시계를 만드는 함수라 epoch 자체가 시프트된 Date 를 돌려준다.
   * 그걸 `timestamptz` 에 넣으면 드리즐이 `toISOString()` 으로 직렬화해 값이 한 번 더 밀린다.
   * 라이브(UTC)에서 3,850행 전부가 정확히 +9h 로 쌓였다 (2026-09-10 실측).
   *
   * 이 스펙은 **런타임 TZ 가 UTC 여야 의미가 있다** — 개발 머신이 `Asia/Seoul` 이면 시프트가
   * 항등이 되어 결함이 사라진다. `scripts/jest/global-setup.js` 가 그래서 UTC 를 박는다.
   */
  it('stamps the audit row with the real instant, not a timezone-shifted wall clock', async () => {
    const instant = new Date('2026-09-11T01:00:00.000Z');
    jest.useFakeTimers().setSystemTime(instant);

    try {
      const transactionValues = jest.fn().mockResolvedValue(undefined);
      const service = new AuditService({ db: insertTarget(jest.fn()) } as never);

      await service.logRequired(auditData, { userId: 'jwt-actor' }, insertTarget(transactionValues) as never);

      expect(transactionValues).toHaveBeenCalledWith(expect.objectContaining({ timestamp: instant }));
    } finally {
      jest.useRealTimers();
    }
  });
});
