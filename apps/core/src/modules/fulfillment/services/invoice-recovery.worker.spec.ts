import { InvoiceRecoveryWorker } from './invoice-recovery.worker';

describe('InvoiceRecoveryWorker', () => {
  it('isolates one failed invoice operation and continues the remaining leases', async () => {
    const invoices = {
      leaseDueOperations: jest
        .fn()
        .mockResolvedValueOnce(['operation-1'])
        .mockResolvedValueOnce(['operation-2'])
        .mockResolvedValueOnce([]),
      processLeasedOperation: jest
        .fn()
        .mockRejectedValueOnce(new Error('provider down'))
        .mockResolvedValueOnce(undefined),
    };
    const worker = new InvoiceRecoveryWorker(invoices as never, { shouldRunInvoiceRecovery: () => true } as never);

    await worker.recover();

    expect(invoices.processLeasedOperation).toHaveBeenCalledTimes(2);
    expect(invoices.processLeasedOperation).toHaveBeenNthCalledWith(2, 'operation-2');
    expect(invoices.leaseDueOperations).toHaveBeenCalledTimes(3);
    expect(invoices.leaseDueOperations).toHaveBeenCalledWith(1);
  });

  it('does not lease operations outside V2 mode', async () => {
    const invoices = { leaseDueOperations: jest.fn(), processLeasedOperation: jest.fn() };
    const worker = new InvoiceRecoveryWorker(invoices as never, { shouldRunInvoiceRecovery: () => false } as never);

    await worker.recover();

    expect(invoices.leaseDueOperations).not.toHaveBeenCalled();
  });
});
