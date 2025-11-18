/**
 * Wallet Domain Stream Configuration
 */

import { event, stream } from '../types';
import { z } from 'zod';

// ===== Payload 타입 정의 =====

export interface WalletTopupSuccessPayload {
  userId: string;
  amount: number;
  currency: string;
  transactionId: string;
  customerEmail?: string;
}

export interface WalletWithdrawalRequestedPayload {
  userId: string;
  amount: number;
  currency: string;
  withdrawalId: string;
  customerEmail?: string;
}

// ===== Zod 스키마 정의 =====

const WalletTopupSuccessSchema = z.object({
  userId: z.string().min(1),
  amount: z.number().nonnegative(),
  currency: z.string().min(1),
  transactionId: z.string().min(1),
  customerEmail: z.string().email().optional(),
});

const WalletWithdrawalRequestedSchema = z.object({
  userId: z.string().min(1),
  amount: z.number().nonnegative(),
  currency: z.string().min(1),
  withdrawalId: z.string().min(1),
  customerEmail: z.string().email().optional(),
});

// ===== Stream Config =====

export const WALLET_STREAM = stream({
  topic: 'wallet.events.v1',
  partitions: 6,
  aggregateType: 'Wallet',
  events: {
    WalletTopupSuccess: event<'WalletTopupSuccess', WalletTopupSuccessPayload>('WalletTopupSuccess', WalletTopupSuccessSchema),
    WalletWithdrawalRequested: event<'WalletWithdrawalRequested', WalletWithdrawalRequestedPayload>('WalletWithdrawalRequested', WalletWithdrawalRequestedSchema),
  },
});


export type WalletEvents = typeof WALLET_STREAM.events;

