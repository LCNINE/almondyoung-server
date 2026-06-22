import { BankTransferPaymentProvider } from './bank-transfer.provider';

describe('BankTransferPaymentProvider', () => {
  it('declares offline-wait action mode (deposit is not a short interactive redirect)', () => {
    const provider = new BankTransferPaymentProvider(null as never);
    expect(provider.actionMode).toBe('offline-wait');
    expect(provider.providerType).toBe('BANK_TRANSFER');
  });
});
