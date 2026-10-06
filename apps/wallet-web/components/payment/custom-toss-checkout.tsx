'use client';

import { useEffect, useRef, useState } from 'react';
import type { TossPaymentsBrandpay } from '@tosspayments/tosspayments-sdk';
import type { BusinessLicenseInfo, TossWidgetConfig } from '@/lib/wallet-api';
import { TossAgreement } from './toss-agreement';
import { CardCheckout, type CheckoutCard, type CheckoutSelection } from './card-checkout';

interface Props {
  customer?: BusinessLicenseInfo | null;
  intentId: string;
  orderName: string;
  amount: number;
  availablePoints: number;
  config: TossWidgetConfig;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onPay: (selection: CheckoutSelection, brandpay?: TossPaymentsBrandpay) => Promise<void>;
}

export function CustomTossCheckout({
  customer,
  intentId,
  orderName,
  amount,
  availablePoints,
  config,
  loading,
  error,
  onClose,
  onPay,
}: Props) {
  const [cards, setCards] = useState<CheckoutCard[]>([]);
  const [preferredCardId, setPreferredCardId] = useState<string | null>(null);
  const [agreementAccepted, setAgreementAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sdkError, setSdkError] = useState<string | null>(null);
  const brandpayRef = useRef<Promise<TossPaymentsBrandpay> | null>(null);

  const loadCards = async (signal?: AbortSignal) => {
    const response = await fetch('/api/toss/brandpay/cards', { cache: 'no-store', signal });
    const body = (await response.json()) as {
      cards?: CheckoutCard[];
      selectedMethodId?: string | null;
      message?: string;
    };
    if (!response.ok) throw new Error(body.message ?? '등록된 카드를 불러오지 못했습니다.');
    setCards(body.cards ?? []);
    setPreferredCardId(body.selectedMethodId ?? null);
  };

  useEffect(() => {
    const abort = new AbortController();
    void loadCards(abort.signal).catch((cause: unknown) => {
      if (!abort.signal.aborted) setSdkError(cause instanceof Error ? cause.message : '카드 조회에 실패했습니다.');
    });
    return () => abort.abort();
  }, [intentId]);

  const getBrandpay = () => {
    if (!brandpayRef.current) {
      brandpayRef.current = (async () => {
        const prepared = await fetch('/api/toss/brandpay/prepare', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ intentId }),
          cache: 'no-store',
        });
        if (!prepared.ok) throw new Error('카드 인증 준비에 실패했습니다. 다시 로그인해주세요.');
        const { redirectUrl } = (await prepared.json()) as { redirectUrl: string };
        if (!config.brandpayClientKey) throw new Error('카드 간편결제 설정이 없습니다.');
        const { loadTossPayments } = await import('@tosspayments/tosspayments-sdk');
        const toss = await loadTossPayments(config.brandpayClientKey);
        return toss.brandpay({ customerKey: config.customerKey, redirectUrl });
      })().catch((cause: unknown) => {
        brandpayRef.current = null;
        throw cause;
      });
    }
    return brandpayRef.current;
  };

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setSdkError(null);
    try {
      await action();
    } catch (cause) {
      const code = cause && typeof cause === 'object' && 'code' in cause ? cause.code : null;
      if (code !== 'USER_CANCEL' && !(cause instanceof Error && cause.name === 'UserCancelError')) {
        setSdkError(cause instanceof Error ? cause.message : '카드 간편결제를 진행하지 못했습니다.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <CardCheckout
      agreementAccepted={agreementAccepted}
      agreement={<TossAgreement onChange={setAgreementAccepted} />}
      customer={customer}
      orderName={orderName}
      amount={amount}
      availablePoints={availablePoints}
      cards={cards}
      preferenceScope={config.customerKey}
      preferredCardId={preferredCardId}
      loading={busy || loading}
      error={error ?? sdkError}
      onClose={onClose}
      testMode={config.clientKey.startsWith('test_')}
      onRegister={() =>
        void run(async () => {
          await (await getBrandpay()).addPaymentMethod();
          await loadCards();
        })
      }
      onSettings={() =>
        void run(async () => {
          await (await getBrandpay()).openSettings();
          await loadCards();
        })
      }
      onPay={(selection) =>
        void run(async () => {
          const brandpay =
            selection.method === 'BRANDPAY' && selection.points < amount ? await getBrandpay() : undefined;
          await onPay(selection, brandpay);
        })
      }
    />
  );
}
