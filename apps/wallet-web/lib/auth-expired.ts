export const WALLET_SESSION_EXPIRED_MESSAGE = '로그인이 만료되었습니다. 다시 로그인해주세요.';

export class WalletSessionExpiredError extends Error {
  readonly status = 401;

  constructor() {
    super(WALLET_SESSION_EXPIRED_MESSAGE);
    this.name = 'WalletSessionExpiredError';
  }
}

export function isWalletSessionExpiredError(error: unknown): error is WalletSessionExpiredError {
  return (
    error instanceof WalletSessionExpiredError ||
    (error instanceof Error && error.name === 'WalletSessionExpiredError')
  );
}

export function buildWalletLoginUrl(origin: string, pathname: string, search = ''): string {
  const redirectTo = `${pathname}${search}`;
  const loginUrl = new URL('/login', origin);
  loginUrl.searchParams.set('redirect_to', redirectTo);
  return loginUrl.toString();
}

export function redirectToWalletLogin(): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.location.assign(buildWalletLoginUrl(window.location.origin, window.location.pathname, window.location.search));
}
