// apps/medusa/src/modules/almond-payment/wallet-refund-refusal.ts
import { MedusaError } from '@medusajs/framework/utils';

/**
 * wallet 의 영구 환불 거절을 갈래로 나눈다(#1016 36번 스펙 §4.1). 기준은 «wallet 이 돈을 어떻게 보는가»:
 * - refused: 돈은 있는데 자동으로 못 돌려준다 → 다른 수단으로 환불
 * - ledger_mismatch: wallet 이 Medusa 생각보다 돌려줄 돈이 적다 → 이미 나갔을 수 있다(응답 유실·일부 leg 만 나감·
 *   투영 안 된 외부 환불). «환불 불가»로 보이면 운영자가 또 환불한다
 * 그 밖은 분류하지 않는다 — 400 으로 바꾸면 channel-adapter 가 재시도 없이 닫는다.
 */
export type WalletRefundRefusalKind = 'refused' | 'ledger_mismatch';

const KIND_BY_WALLET_CODE = new Map<string, WalletRefundRefusalKind>([
  ['REFUND_NOT_AUTOMATABLE', 'refused'],
  ['MEMBERSHIP_REFUND_NOT_ALLOWED', 'refused'],
  ['REFUND_AMOUNT_EXCEEDS_TOTAL', 'ledger_mismatch'],
  ['REFUND_AMOUNT_EXCEEDS_AVAILABLE', 'ledger_mismatch'],
  ['REFUND_AMOUNT_EXCEEDS_CHARGE', 'ledger_mismatch'],
  // intent 환불 경로에선 SUCCEEDED 결제분을 고른 뒤 누가 동시에 환불했을 때만 난다
  ['CHARGE_NOT_REFUNDABLE', 'ledger_mismatch'],
  // 404 지만 본문 코드로 가린다 — 환불할 결제분이 없는데 성공 환불 합도 모자라다
  ['REFUNDABLE_CHARGE_NOT_FOUND', 'ledger_mismatch'],
]);

export function classifyWalletRefundRefusal(walletCode: string | undefined): WalletRefundRefusalKind | null {
  return walletCode === undefined ? null : (KIND_BY_WALLET_CODE.get(walletCode) ?? null);
}

/** wallet 이 2xx 가 아닌 응답을 줬다. 속성 이름을 code 로 두지 않는다 — formatException 이 err.code 를 Postgres 코드로 읽는다 */
export class WalletHttpError extends Error {
  constructor(
    readonly status: number,
    readonly walletCode: string | undefined,
    readonly walletMessage: string,
  ) {
    // 에러 코드를 메시지 앞에 붙인다 — 호출부가 코드로 분기할 수 있어야 한다(INTENT_NOT_CANCELABLE 등)
    super(walletCode ? `${walletCode}: ${walletMessage}` : walletMessage);
    this.name = 'WalletHttpError';
  }
}

const SENTENCE: Record<WalletRefundRefusalKind, string> = {
  refused: 'wallet 이 이 결제를 자동으로 환불할 수 없습니다 — 다른 수단으로 환불해야 합니다',
  ledger_mismatch:
    'wallet 에 Medusa 장부에 없는 환불이 있습니다 — 이미 환불됐을 수 있으니 다시 환불하지 말고 wallet 환불 내역을 대조하세요',
};

/**
 * Medusa 에러 핸들러는 NOT_ALLOWED 를 400 으로, code 를 그대로 응답에 싣는다(그 밖의 오류는 500 unknown_error 로 가린다).
 * 표지 형식은 channel-adapter 가 읽는다 — 짝: apps/channel-adapter/src/adapters/medusa/refund-failure.ts
 */
export function walletRefundRefusalError(
  kind: WalletRefundRefusalKind,
  walletCode: string,
  walletMessage: string,
): MedusaError {
  return new MedusaError(
    MedusaError.Types.NOT_ALLOWED,
    `${SENTENCE[kind]} (wallet ${walletCode}: ${walletMessage})`,
    `wallet_refund_${kind}:${walletCode}`,
  );
}

const REFUND_FAILURE_CODE = /^wallet_refund_(refused|ledger_mismatch):(.+)$/;

/** 워크플로를 지나 직렬화된 오류(클래스가 아니라 평범한 객체)에서 표지를 다시 읽는다 — 부분취소 502 본문용 */
export function readRefundFailureCode(error: unknown): { kind: WalletRefundRefusalKind; walletCode: string } | null {
  if (typeof error !== 'object' || error === null || !('code' in error) || typeof error.code !== 'string') return null;
  const match = REFUND_FAILURE_CODE.exec(error.code);
  if (!match) return null;
  return { kind: match[1] === 'refused' ? 'refused' : 'ledger_mismatch', walletCode: match[2] };
}
