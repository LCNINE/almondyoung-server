import { BaseEventPayload, EventDefinition } from '@app/events';

export interface WalletTopupSuccessPayload extends BaseEventPayload {
  userId: string;
  amount: number;
  currency: string;
  transactionId: string;
  customerEmail?: string;
}

export interface WalletWithdrawalRequestedPayload extends BaseEventPayload {
  userId: string;
  amount: number;
  currency: string;
  withdrawalId: string;
  customerEmail?: string;
}

export const WALLET_EVENTS = {
  WALLET_TOPUP_SUCCESS: {
    topic: 'wallet.topup.success',
    payload: {} as WalletTopupSuccessPayload,
  },
  WALLET_WITHDRAWAL_REQUESTED: {
    topic: 'wallet.withdrawal.requested',
    payload: {} as WalletWithdrawalRequestedPayload,
  },
} as const satisfies Record<string, EventDefinition>;

export type WalletEvents = typeof WALLET_EVENTS;
