import { canonicalShipmentRecipientHash, InvoiceOrchestrator } from './invoice-orchestrator.service';
import { DeliveryProviderError } from './delivery-provider.interface';

describe('InvoiceOrchestrator provider crash recovery', () => {
  const commandContext = { actorId: 'actor-1', reason: 'test', csCaseId: null, note: null };

  function operation(overrides: Record<string, unknown> = {}) {
    return {
      id: 'operation-1',
      shipmentId: 'shipment-1',
      invoiceId: 'invoice-1',
      resumeOperationId: null,
      operation: 'issue',
      idempotencyKey: 'request-key',
      requestHash: 'a'.repeat(64),
      manifestVersion: 3,
      recipientHash: 'b'.repeat(64),
      status: 'in_progress',
      providerRequest: {
        kind: 'issue',
        provider: 'goodsflow',
        carrierCode: 'CJ',
        operationContext: { operationId: 'operation-1', idempotencyKey: 'operation-1' },
        commandContext,
        shipment: {
          id: 'shipment-1',
          warehouseId: 'warehouse-1',
          manifestVersion: 3,
          shippingProfileId: 'profile-1',
          recipientSnapshot: {},
        },
        profile: {},
        lines: [],
        deliveryRequest: {
          centerCode: 'center',
          recipientName: 'Recipient',
          recipientAddress: 'Address',
          recipientPhone: '010',
          carrierCode: 'CJ',
          items: [],
        },
      },
      providerResponse: null,
      attempts: 1,
      lastError: null,
      nextRetryAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
      updatedAt: new Date(),
      completedAt: null,
      ...overrides,
    } as any;
  }

  function makeService(capabilities?: {
    issue: { safeToRepeat: boolean; lookupByIdempotencyKey: boolean };
    void: { safeToRepeat: boolean; lookupByServiceId: boolean };
  }) {
    const provider = {
      maxRequestDurationMs: 1_000,
      capabilities: capabilities ?? {
        issue: { safeToRepeat: true, lookupByIdempotencyKey: false },
        void: { safeToRepeat: true, lookupByServiceId: false },
      },
      issueInvoice: jest.fn().mockResolvedValue({
        serviceId: 'service-1',
        invoiceNumber: 'tracking-1',
        carrierCode: 'CJ',
      }),
      queryInvoice: jest.fn(),
      cancelInvoice: jest.fn().mockResolvedValue(undefined),
    };
    const service = new InvoiceOrchestrator(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      provider as never,
      provider as never,
      {} as never,
      {} as never,
    );
    return { service, provider };
  }

  it('durably stores provider success before finalizing the invoice', async () => {
    const { service, provider } = makeService();
    jest.spyOn(service as any, 'loadLeasedOperation').mockResolvedValue(operation());
    const persist = jest.spyOn(service as any, 'persistProviderResponse').mockResolvedValue(undefined);
    const finalize = jest.spyOn(service as any, 'finalizeProviderSuccess').mockResolvedValue(undefined);
    const failure = jest.spyOn(service as any, 'recordFailure').mockResolvedValue(undefined);

    await service.processLeasedOperation('operation-1');

    expect(provider.issueInvoice).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith(
      'operation-1',
      1,
      expect.objectContaining({ serviceId: 'service-1', invoiceNumber: 'tracking-1' }),
    );
    expect(persist.mock.invocationCallOrder[0]).toBeLessThan(finalize.mock.invocationCallOrder[0]);
    expect(failure).not.toHaveBeenCalled();
  });

  it('after a DB-finalization crash, reuses the durable provider response without another provider call', async () => {
    const { service, provider } = makeService();
    jest
      .spyOn(service as any, 'loadLeasedOperation')
      .mockResolvedValue(
        operation({ providerResponse: { serviceId: 'service-1', invoiceNumber: 'tracking-1', carrierCode: 'CJ' } }),
      );
    const finalize = jest.spyOn(service as any, 'finalizeProviderSuccess').mockResolvedValue(undefined);

    await service.processLeasedOperation('operation-1');

    expect(provider.issueInvoice).not.toHaveBeenCalled();
    expect(finalize).toHaveBeenCalledWith('operation-1');
  });

  it('re-reads a durable provider response and schedules finalization retry even when provider repeat is unsupported', async () => {
    const { service } = makeService({
      issue: { safeToRepeat: false, lookupByIdempotencyKey: false },
      void: { safeToRepeat: false, lookupByServiceId: false },
    });
    const current = operation({
      providerResponse: { serviceId: 'service-1', invoiceNumber: 'tracking-1', carrierCode: 'CJ' },
    });
    const updates: Array<{ table: unknown; set: Record<string, unknown> }> = [];
    const tx = {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            limit: jest.fn(() => ({ for: jest.fn().mockResolvedValue([current]) })),
          })),
        })),
      })),
      update: jest.fn((table: unknown) => ({
        set: jest.fn((set: Record<string, unknown>) => {
          updates.push({ table, set });
          return { where: jest.fn().mockResolvedValue(undefined) };
        }),
      })),
    };
    (service as any).dbService = { run: (fn: (trx: unknown) => unknown) => fn(tx) };
    (service as any).audit = { logUserActionRequired: jest.fn().mockResolvedValue(undefined) };

    await (service as any).recordFailure(operation(), new Error('finalization transaction failed'));

    expect(updates[0].set).toMatchObject({ status: 'recovery_required' });
    expect(updates[0].set.nextRetryAt).toBeInstanceOf(Date);
  });

  it('voids the local issuing placeholder when unsupported is known before any provider side effect', async () => {
    const { service } = makeService({
      issue: { safeToRepeat: false, lookupByIdempotencyKey: false },
      void: { safeToRepeat: false, lookupByServiceId: false },
    });
    const current = operation();
    const updates: Array<{ table: unknown; set: Record<string, unknown> }> = [];
    const tx = {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            limit: jest.fn(() => ({ for: jest.fn().mockResolvedValue([current]) })),
          })),
        })),
      })),
      update: jest.fn((table: unknown) => ({
        set: jest.fn((set: Record<string, unknown>) => {
          updates.push({ table, set });
          return { where: jest.fn().mockResolvedValue(undefined) };
        }),
      })),
    };
    (service as any).dbService = { run: (fn: (trx: unknown) => unknown) => fn(tx) };
    (service as any).audit = { logUserActionRequired: jest.fn().mockResolvedValue(undefined) };

    await (service as any).recordFailure(current, new DeliveryProviderError('contract not verified', 'unsupported'));

    expect(updates[0].set).toMatchObject({ status: 'failed', nextRetryAt: null });
    expect(updates[1].set).toMatchObject({ status: 'voided' });
    expect(updates[1].set.voidedAt).toBeInstanceOf(Date);
  });

  it('queries by the stable operation key before repeating an unknown issue', async () => {
    const { service, provider } = makeService({
      issue: { safeToRepeat: false, lookupByIdempotencyKey: true },
      void: { safeToRepeat: false, lookupByServiceId: false },
    });
    provider.queryInvoice.mockResolvedValue({
      status: 'found',
      serviceId: 'service-existing',
      invoiceNumber: 'tracking-existing',
    });
    jest.spyOn(service as any, 'loadLeasedOperation').mockResolvedValue(operation({ attempts: 2 }));
    const persist = jest.spyOn(service as any, 'persistProviderResponse').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'finalizeProviderSuccess').mockResolvedValue(undefined);

    await service.processLeasedOperation('operation-1');

    expect(provider.queryInvoice).toHaveBeenCalledWith(
      { idempotencyKey: 'operation-1' },
      { operationId: 'operation-1', idempotencyKey: 'operation-1' },
    );
    expect(provider.issueInvoice).not.toHaveBeenCalled();
    expect(persist).toHaveBeenCalledWith(
      'operation-1',
      2,
      expect.objectContaining({ serviceId: 'service-existing', invoiceNumber: 'tracking-existing' }),
    );
  });

  it('fails closed before a new issue when the provider has no idempotency or lookup contract', async () => {
    const { service, provider } = makeService({
      issue: { safeToRepeat: false, lookupByIdempotencyKey: false },
      void: { safeToRepeat: false, lookupByServiceId: true },
    });
    jest.spyOn(service as any, 'loadLeasedOperation').mockResolvedValue(operation());
    const failure = jest.spyOn(service as any, 'recordFailure').mockResolvedValue(undefined);

    await service.processLeasedOperation('operation-1');

    expect(provider.issueInvoice).not.toHaveBeenCalled();
    expect(failure).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'operation-1' }),
      expect.objectContaining<Partial<DeliveryProviderError>>({ outcome: 'unsupported' }),
    );
  });

  it('refuses a provider call whose timeout can outlive the operation lease', async () => {
    const { service, provider } = makeService();
    provider.maxRequestDurationMs = 60_000;
    jest.spyOn(service as any, 'loadLeasedOperation').mockResolvedValue(operation());
    const failure = jest.spyOn(service as any, 'recordFailure').mockResolvedValue(undefined);

    await service.processLeasedOperation('operation-1');

    expect(provider.issueInvoice).not.toHaveBeenCalled();
    expect(failure).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'operation-1' }),
      expect.objectContaining<Partial<DeliveryProviderError>>({ outcome: 'unsupported' }),
    );
  });

  it('treats a provider-confirmed canceled label as void success without another cancel call', async () => {
    const { service, provider } = makeService({
      issue: { safeToRepeat: false, lookupByIdempotencyKey: false },
      void: { safeToRepeat: false, lookupByServiceId: true },
    });
    provider.queryInvoice.mockResolvedValue({
      status: 'found',
      serviceId: 'service-1',
      invoiceNumber: 'tracking-1',
      tracking: { status: 'canceled' },
    });
    const voidRequest = {
      kind: 'void',
      provider: 'goodsflow',
      operationContext: { operationId: 'operation-1', idempotencyKey: 'operation-1' },
      commandContext,
      invoiceId: 'invoice-1',
      shipmentId: 'shipment-1',
      externalServiceId: 'service-1',
      trackingNo: 'tracking-1',
    };
    jest
      .spyOn(service as any, 'loadLeasedOperation')
      .mockResolvedValue(operation({ operation: 'void', attempts: 2, providerRequest: voidRequest }));
    jest.spyOn(service as any, 'persistProviderResponse').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'finalizeProviderSuccess').mockResolvedValue(undefined);
    const failure = jest.spyOn(service as any, 'recordFailure').mockResolvedValue(undefined);

    await service.processLeasedOperation('operation-1');

    expect(provider.cancelInvoice).not.toHaveBeenCalled();
    expect(failure).not.toHaveBeenCalled();
  });

  it('does not repeat a found-but-active Goodsflow void when repeat safety is undocumented', async () => {
    const { service, provider } = makeService({
      issue: { safeToRepeat: false, lookupByIdempotencyKey: false },
      void: { safeToRepeat: false, lookupByServiceId: true },
    });
    provider.queryInvoice.mockResolvedValue({
      status: 'found',
      serviceId: 'service-1',
      invoiceNumber: 'tracking-1',
      tracking: { status: 'pending' },
    });
    const voidRequest = {
      kind: 'void',
      provider: 'goodsflow',
      operationContext: { operationId: 'operation-1', idempotencyKey: 'operation-1' },
      commandContext,
      invoiceId: 'invoice-1',
      shipmentId: 'shipment-1',
      externalServiceId: 'service-1',
      trackingNo: 'tracking-1',
    };
    jest
      .spyOn(service as any, 'loadLeasedOperation')
      .mockResolvedValue(operation({ operation: 'void', attempts: 2, providerRequest: voidRequest }));
    const failure = jest.spyOn(service as any, 'recordFailure').mockResolvedValue(undefined);

    await service.processLeasedOperation('operation-1');

    expect(provider.cancelInvoice).not.toHaveBeenCalled();
    expect(failure).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'operation-1' }),
      expect.objectContaining<Partial<DeliveryProviderError>>({ outcome: 'unsupported' }),
    );
  });

  it('accepts a still-pending consolidation resume result so earlier voids can commit', async () => {
    const { service } = makeService();
    const resumePending = jest.fn().mockResolvedValue({ operationStatus: 'pending', targetShipmentId: null });
    (service as any).moduleRef = { get: jest.fn(() => ({ resumePending })) };
    const tx = {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({ limit: jest.fn().mockResolvedValue([{ type: 'consolidate', status: 'pending' }]) })),
        })),
      })),
    };

    await (service as any).resumeWaitingOperation('consolidation-1', tx);

    expect(resumePending).toHaveBeenCalledWith('consolidation-1', tx);
  });

  it('does not treat a prior unknown void as a fresh voidable stale issue', async () => {
    const { service } = makeService();
    const tx = {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            orderBy: jest.fn().mockResolvedValue([
              {
                operation: 'issue',
                status: 'recovery_required',
                lastError: 'Shipment manifest or recipient changed while the provider issue was in flight',
                providerResponse: { serviceId: 'service-1', invoiceNumber: 'tracking-1' },
              },
              {
                operation: 'void',
                status: 'recovery_required',
                lastError: 'provider timeout',
                providerResponse: null,
              },
            ]),
          })),
        })),
      })),
    };

    await expect((service as any).hasRecoverableStaleIssue('invoice-1', 'service-1', 'tracking-1', tx)).resolves.toBe(
      false,
    );
  });

  it('falls back to the validated stored carrier when a provider returns an unknown carrier', () => {
    const { service } = makeService();

    expect((service as any).normalizedCarrier('PROVIDER_TYPO', operation().providerRequest)).toBe('CJ');
  });

  it('rejects dispatch when an issued invoice still lacks provider execution identity', async () => {
    const { service } = makeService();
    const recipientSnapshot = { recipientName: 'Recipient' };
    const shipment = { id: 'shipment-1', manifestVersion: 3, recipientSnapshot };
    const invoice = {
      id: 'invoice-1',
      shipmentId: 'shipment-1',
      status: 'issued',
      manifestVersion: 3,
      recipientHash: canonicalShipmentRecipientHash(recipientSnapshot),
      carrier: null,
      externalServiceId: 'service-1',
      trackingNo: 'tracking-1',
    };
    const select = jest
      .fn()
      .mockReturnValueOnce({
        from: jest.fn(() => ({
          where: jest.fn(() => ({ limit: jest.fn().mockResolvedValue([shipment]) })),
        })),
      })
      .mockReturnValueOnce({
        from: jest.fn(() => ({ where: jest.fn().mockResolvedValue([invoice]) })),
      });
    (service as any).dbService = { run: (fn: (tx: unknown) => unknown) => fn({ select }) };

    await expect(service.assertDispatchableInvoice('shipment-1')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'SHIPMENT_INVOICE_NOT_READY' }),
    });
  });
});
