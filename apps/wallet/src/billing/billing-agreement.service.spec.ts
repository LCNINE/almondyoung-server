import { BillingAgreementService } from './billing-agreement.service';

function makeDb(rows: Record<string, unknown>[] = []) {
  const returning = jest.fn().mockResolvedValue(rows);
  const values = jest.fn().mockReturnValue({ returning });
  const insert = jest.fn().mockReturnValue({ values });
  const set = jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ returning }) });
  const update = jest.fn().mockReturnValue({ set });
  const limit = jest.fn().mockResolvedValue([]);
  const where = jest.fn().mockReturnValue({ limit });
  const select = jest.fn().mockReturnValue({ from: jest.fn().mockReturnValue({ where }) });

  return {
    db: { insert, update, select },
    spies: { insert, update, returning },
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

    expect(billingMethodService.assertSelectableForRecurringBilling).toHaveBeenCalledWith('user-1', 'method-1');
    expect(db.spies.insert).toHaveBeenCalled();
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
});
