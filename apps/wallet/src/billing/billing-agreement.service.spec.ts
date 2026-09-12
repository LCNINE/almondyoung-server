import { BillingAgreementService } from './billing-agreement.service';

function makeDb(rows: Record<string, unknown>[] = []) {
  const returning = jest.fn().mockResolvedValue(rows);
  const onConflictDoUpdate = jest.fn().mockReturnValue({ returning });
  const values = jest.fn().mockReturnValue({ returning, onConflictDoUpdate });
  const insert = jest.fn().mockReturnValue({ values });
  const set = jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ returning }) });
  const update = jest.fn().mockReturnValue({ set });
  const limit = jest.fn().mockResolvedValue([]);
  const where = jest.fn().mockReturnValue({ limit });
  const select = jest.fn().mockReturnValue({ from: jest.fn().mockReturnValue({ where }) });

  return {
    db: { insert, update, select },
    spies: { insert, update, returning, onConflictDoUpdate, values },
  };
}

describe('BillingAgreementService recurring billing method guards', () => {
  const agreement = {
    id: 'agreement-1',
    userId: 'user-1',
    billingMethodId: 'method-1',
    subscriberRef: 'sub-1',
    subscriberType: 'membership',
    status: 'ACTIVE',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('validates explicit create billing method through recurring-billing selectability', async () => {
    const db = makeDb([agreement]);
    const billingMethodService = {
      assertSelectableForRecurringBilling: jest.fn().mockResolvedValue({ id: 'method-1' }),
      findLatestSelectableForRecurringBilling: jest.fn(),
    };
    const service = new BillingAgreementService(db as never, billingMethodService as never);

    await service.create('user-1', 'method-1', 'sub-1', 'membership');

    expect(billingMethodService.assertSelectableForRecurringBilling).toHaveBeenCalledWith(
      'user-1',
      'method-1',
      undefined,
    );
    expect(db.spies.insert).toHaveBeenCalled();
  });

  it('선적용(allowPendingMandate) 옵션을 selectability 검증까지 전달한다', async () => {
    const db = makeDb([agreement]);
    const billingMethodService = {
      assertSelectableForRecurringBilling: jest.fn().mockResolvedValue({ id: 'method-1' }),
      findLatestSelectableForRecurringBilling: jest.fn(),
    };
    const service = new BillingAgreementService(db as never, billingMethodService as never);

    await service.create('user-1', 'method-1', 'sub-1', 'membership', { allowPendingMandate: true });

    expect(billingMethodService.assertSelectableForRecurringBilling).toHaveBeenCalledWith('user-1', 'method-1', {
      allowPendingMandate: true,
    });
  });

  it('rejects explicit create when CMS method is not selectable', async () => {
    const db = makeDb([agreement]);
    const billingMethodService = {
      assertSelectableForRecurringBilling: jest.fn().mockRejectedValue(new Error('CMS billing method is not ready')),
      findLatestSelectableForRecurringBilling: jest.fn(),
    };
    const service = new BillingAgreementService(db as never, billingMethodService as never);

    await expect(service.create('user-1', 'method-1', 'sub-1', 'membership')).rejects.toThrow(
      'CMS billing method is not ready',
    );
    expect(db.spies.insert).not.toHaveBeenCalled();
  });

  it('uses the latest selectable method for auto agreement creation', async () => {
    const db = makeDb([agreement]);
    const billingMethodService = {
      assertSelectableForRecurringBilling: jest.fn().mockResolvedValue({ id: 'method-selectable' }),
      findLatestSelectableForRecurringBilling: jest.fn().mockResolvedValue({ id: 'method-selectable' }),
    };
    const service = new BillingAgreementService(db as never, billingMethodService as never);

    await service.createWithAutoMethod('user-1', 'sub-1', 'membership');

    expect(billingMethodService.findLatestSelectableForRecurringBilling).toHaveBeenCalledWith('user-1');
    expect(billingMethodService.assertSelectableForRecurringBilling).toHaveBeenCalledWith(
      'user-1',
      'method-selectable',
      undefined,
    );
  });

  it('fails auto agreement creation when no selectable method exists', async () => {
    const db = makeDb([agreement]);
    const billingMethodService = {
      assertSelectableForRecurringBilling: jest.fn(),
      findLatestSelectableForRecurringBilling: jest.fn().mockResolvedValue(undefined),
    };
    const service = new BillingAgreementService(db as never, billingMethodService as never);

    await expect(service.createWithAutoMethod('user-1', 'sub-1', 'membership')).rejects.toThrow(
      'no selectable billing method found',
    );
  });

  it('validates updateBillingMethod through recurring-billing selectability', async () => {
    const db = makeDb([{ id: 'agreement-1' }]);
    const billingMethodService = {
      assertSelectableForRecurringBilling: jest.fn().mockResolvedValue({ id: 'method-2' }),
      findLatestSelectableForRecurringBilling: jest.fn(),
    };
    const service = new BillingAgreementService(db as never, billingMethodService as never);

    await service.updateBillingMethod('agreement-1', 'method-2', 'user-1');

    expect(billingMethodService.assertSelectableForRecurringBilling).toHaveBeenCalledWith('user-1', 'method-2');
    expect(db.spies.update).toHaveBeenCalled();
  });

  it('create 는 subscriber 충돌 시 REVOKED 행을 ACTIVE 로 되살리는 upsert 를 쓴다', async () => {
    const db = makeDb([agreement]);
    const billingMethodService = {
      assertSelectableForRecurringBilling: jest.fn().mockResolvedValue({ id: 'method-1' }),
      findLatestSelectableForRecurringBilling: jest.fn(),
    };
    const service = new BillingAgreementService(db as never, billingMethodService as never);

    await service.create('user-1', 'method-1', 'sub-1', 'membership');

    expect(db.spies.onConflictDoUpdate).toHaveBeenCalledTimes(1);
    const arg = db.spies.onConflictDoUpdate.mock.calls[0][0];
    expect(arg.set).toMatchObject({ status: 'ACTIVE', billingMethodId: 'method-1', userId: 'user-1' });
    expect(Array.isArray(arg.target)).toBe(true);
    expect(arg.target).toHaveLength(2);
  });
});

describe('BillingAgreementService 선적용 가입 통지', () => {
  const agreement = {
    id: 'agreement-1',
    userId: 'user-1',
    billingMethodId: 'method-1',
    subscriberRef: 'sub-1',
    subscriberType: 'MEMBERSHIP',
    status: 'ACTIVE',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  function makeDeps(cmsMemberStatus: string) {
    const enqueue = jest.fn().mockResolvedValue(undefined);
    return {
      enqueue,
      billingMethodService: {
        assertSelectableForRecurringBilling: jest.fn().mockResolvedValue({ id: 'method-1' }),
        findLatestSelectableForRecurringBilling: jest.fn(),
        getUserCmsBillingMethodStatuses: jest
          .fn()
          .mockResolvedValue([{ billingMethodId: 'method-1', cmsMemberStatus }]),
      },
      contacts: {
        findContacts: jest.fn().mockResolvedValue(new Map([['user-1', { email: 'a@b.com', username: '홍길동' }]])),
      },
      config: { get: jest.fn().mockReturnValue('set') },
    };
  }

  function makeService(db: ReturnType<typeof makeDb>, deps: ReturnType<typeof makeDeps>) {
    const dbService = { ...db, run: (fn: (trx: unknown) => unknown) => fn({}) };
    return new BillingAgreementService(
      dbService as never,
      deps.billingMethodService as never,
      deps.contacts as never,
      deps.config as never,
      { enqueue: deps.enqueue } as never,
    );
  }

  it('심사 중(PENDING) 계좌로 가입하면 mandate.pending 을 계약당 한 번 발행한다', async () => {
    const deps = makeDeps('PENDING');
    const service = makeService(makeDb([agreement]), deps);

    await service.create('user-1', 'method-1', 'sub-1', 'MEMBERSHIP', { allowPendingMandate: true });

    expect(deps.enqueue).toHaveBeenCalledTimes(1);
    const params = deps.enqueue.mock.calls[0][0];
    expect(params.eventType).toBe('mandate.pending');
    expect(params.idempotencyKey).toBe('cms:mandate-pending:MEMBERSHIP:sub-1');
    expect(params.payload.email).toBe('a@b.com');
  });

  it('이미 승인된 계좌면 선적용이 아니므로 발행하지 않는다', async () => {
    const deps = makeDeps('REGISTERED');
    const service = makeService(makeDb([agreement]), deps);

    await service.create('user-1', 'method-1', 'sub-1', 'MEMBERSHIP', { allowPendingMandate: true });

    expect(deps.enqueue).not.toHaveBeenCalled();
  });

  it('통지 발행이 실패해도 계약 생성은 성립한다', async () => {
    const deps = makeDeps('PENDING');
    deps.enqueue.mockRejectedValue(new Error('outbox down'));
    const service = makeService(makeDb([agreement]), deps);

    await expect(
      service.create('user-1', 'method-1', 'sub-1', 'MEMBERSHIP', { allowPendingMandate: true }),
    ).resolves.toEqual(agreement);
  });
});
