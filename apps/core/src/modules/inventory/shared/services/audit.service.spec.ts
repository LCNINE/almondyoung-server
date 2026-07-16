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
});
