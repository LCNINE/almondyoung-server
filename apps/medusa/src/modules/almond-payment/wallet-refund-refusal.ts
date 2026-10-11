import { MedusaError } from '@medusajs/framework/utils';

import { describeError } from '../../utils/describe-error';

/**
 * wallet 환불 오류 번역(#1016 36번 재설계 스펙 §6.4). 영구/일시 분류의 정본은 wallet 이다 — 여기는 `retryable === false` 만
 * 표지 오류로 바꾸고 나머지는 그대로 둔다(일시). 표지 `wallet_refund_refused:<코드>` 는 channel-adapter 가 읽는다.
 */
export const WALLET_REFUND_REFUSED_PREFIX = 'wallet_refund_refused:';

/** wallet 이 2xx 가 아닌 응답을 줬다. 속성 이름을 code 로 두지 않는다 — Medusa formatException 이 err.code 를 Postgres 코드로 읽는다 */
export class WalletHttpError extends Error {
  constructor(
    readonly status: number,
    readonly walletCode: string | undefined,
    readonly walletMessage: string,
    /** wallet 거절 본문의 retryable. 없으면 undefined — 일시로 읽는다 */
    readonly retryable?: boolean,
  ) {
    // «코드: 문장» — 호출부의 includes 분기(NO_STAGED_APPROVAL·INTENT_NOT_CANCELABLE)가 그대로 돈다
    super(walletCode ? `${walletCode}: ${walletMessage}` : walletMessage);
    this.name = 'WalletHttpError';
  }
}

/** Medusa 에러 핸들러는 NOT_ALLOWED 를 400 으로, code 를 그대로 응답 본문에 싣는다 */
export function walletRefundRefusedError(code: string, message: string): MedusaError {
  return new MedusaError(MedusaError.Types.NOT_ALLOWED, message, `${WALLET_REFUND_REFUSED_PREFIX}${code}`);
}

/** wallet 4xx 거절이 `retryable: false` 면 표지 오류, 아니면 null — null 이면 원래 오류를 그대로 던진다(일시) */
export function refusalFromWalletHttpError(error: unknown): MedusaError | null {
  if (!(error instanceof WalletHttpError)) return null;
  if (error.status < 400 || error.status >= 500 || error.retryable !== false || !error.walletCode) return null;
  return walletRefundRefusedError(error.walletCode, error.walletMessage);
}

/** 워크플로를 지나 평범한 객체가 된 오류에서도 표지를 읽는다 — 정산 라우트가 «영구 거절»과 «그 밖»을 가를 때 쓴다 */
export function readWalletRefundRefusal(error: unknown): { code: string; message: string } | null {
  if (typeof error !== 'object' || error === null || !('code' in error) || typeof error.code !== 'string') return null;
  if (!error.code.startsWith(WALLET_REFUND_REFUSED_PREFIX)) return null;
  const code = error.code.slice(WALLET_REFUND_REFUSED_PREFIX.length);
  return code ? { code, message: describeError(error) } : null;
}
