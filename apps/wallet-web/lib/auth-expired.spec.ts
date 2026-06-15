import {
  WalletSessionExpiredError,
  buildWalletLoginUrl,
  isWalletSessionExpiredError,
} from './auth-expired';

describe('auth-expired helpers', () => {
  it('builds a wallet login URL that returns to the current path and query', () => {
    expect(buildWalletLoginUrl('https://wallet-web.example.com', '/pay/pi_123', '?region=kr')).toBe(
      'https://wallet-web.example.com/login?redirect_to=%2Fpay%2Fpi_123%3Fregion%3Dkr',
    );
  });

  it('recognizes wallet session expiration errors', () => {
    expect(isWalletSessionExpiredError(new WalletSessionExpiredError())).toBe(true);
    expect(isWalletSessionExpiredError(new Error('other'))).toBe(false);
  });
});
