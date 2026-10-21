const DEFAULT_DEPOSIT_WINDOW_HOURS = 72;

/** 무통장(가상계좌) 입금 윈도우. 토스 발급 validHours 와 우리 intent.expiresAt 이 같은 값을 쓴다. */
export function depositWindowHours(): number {
  const raw = Number(process.env.WALLET_BANK_TRANSFER_DEPOSIT_WINDOW_HOURS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_DEPOSIT_WINDOW_HOURS;
}
