'use client';

import { useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type {
  TossPaymentsWidgets,
  WidgetAgreementWidget,
  WidgetPaymentMethodWidget,
} from '@tosspayments/tosspayments-sdk';

interface Props {
  intentId: string;
  clientKey: string;
  variantKey: string;
  customerKey: string;
  amount: number;
  widgetsRef: RefObject<TossPaymentsWidgets | null>;
  setReadyAmount: Dispatch<SetStateAction<number | null>>;
  setError: Dispatch<SetStateAction<string | null>>;
}

export function TossPaymentWidget({
  intentId,
  clientKey,
  variantKey,
  customerKey,
  amount,
  widgetsRef,
  setReadyAmount,
  setError,
}: Props) {
  const [initialized, setInitialized] = useState(false);
  const latestAmount = useRef(amount);
  const appliedAmount = useRef<number | null>(null);
  const amountUpdate = useRef<Promise<void>>(Promise.resolve());
  latestAmount.current = amount;

  useEffect(() => {
    let disposed = false;
    const debug = (step: string, details?: Record<string, unknown>) => {
      if (process.env.NODE_ENV !== 'production') console.info(`[toss-widget] ${step}`, details ?? {});
    };
    const logSdkError = (event: PromiseRejectionEvent) => {
      if (process.env.NODE_ENV === 'production') return;
      const reason: unknown = event.reason;
      const error = reason && typeof reason === 'object' ? (reason as { name?: unknown; message?: unknown }) : null;
      console.error('[toss-widget] unhandled promise rejection', {
        name: typeof error?.name === 'string' ? error.name : 'UnknownError',
        message: typeof error?.message === 'string' ? error.message : '오류 메시지 없음',
      });
    };
    window.addEventListener('unhandledrejection', logSdkError);
    let paymentMethods: WidgetPaymentMethodWidget | null = null;
    let agreement: WidgetAgreementWidget | null = null;
    const destroy = () => {
      void Promise.allSettled([paymentMethods?.destroy(), agreement?.destroy()]);
    };

    void (async () => {
      try {
        // React 개발 모드의 Strict Mode가 첫 effect를 즉시 정리한다. SDK를 만들기 전에
        // 한 번 양보해 정리된 effect가 Toss 브리지 인스턴스를 남기지 않게 한다.
        await Promise.resolve();
        if (disposed) return;
        debug('initializing', { testMode: clientKey.startsWith('test_'), variantKey });
        const prepared = await fetch('/api/toss/brandpay/prepare', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ intentId }),
          cache: 'no-store',
        });
        if (disposed) return;
        debug('brandpay prepare response', { status: prepared.status });
        if (!prepared.ok) throw new Error('브랜드페이 인증 준비에 실패했습니다. 다시 로그인하거나 새로고침해주세요.');
        const { redirectUrl } = (await prepared.json()) as { redirectUrl: string };
        if (disposed) return;
        const { loadTossPayments } = await import('@tosspayments/tosspayments-sdk');
        if (disposed) return;
        const tossPayments = await loadTossPayments(clientKey);
        if (disposed) return;
        const widgets = tossPayments.widgets({ customerKey, brandpay: { redirectUrl } });
        const initialAmount = latestAmount.current;
        await widgets.setAmount({ currency: 'KRW', value: initialAmount });
        if (disposed) return;
        paymentMethods = await widgets.renderPaymentMethods({ selector: '#toss-payment-methods', variantKey });
        if (disposed) {
          destroy();
          return;
        }
        agreement = await widgets.renderAgreement({ selector: '#toss-payment-agreement' });
        if (disposed) {
          destroy();
          return;
        }
        widgetsRef.current = widgets;
        appliedAmount.current = initialAmount;
        setReadyAmount(initialAmount);
        setInitialized(true);
        debug('ready');
      } catch (error) {
        destroy();
        debug('initialization failed', { message: error instanceof Error ? error.message : '알 수 없는 오류' });
        if (!disposed) setError(error instanceof Error ? error.message : '토스 결제 UI를 불러오지 못했습니다.');
      }
    })();

    return () => {
      disposed = true;
      window.removeEventListener('unhandledrejection', logSdkError);
      debug('disposed');
      widgetsRef.current = null;
      appliedAmount.current = null;
      setReadyAmount(null);
      destroy();
    };
  }, [clientKey, customerKey, intentId, variantKey, widgetsRef, setReadyAmount, setError]);

  useEffect(() => {
    if (!initialized || !widgetsRef.current) return;
    if (appliedAmount.current === amount) return;
    let cancelled = false;
    setReadyAmount(null);
    const widgets = widgetsRef.current;
    const update = amountUpdate.current.then(() => widgets.setAmount({ currency: 'KRW', value: amount }));
    amountUpdate.current = update.catch(() => undefined);
    void update
      .then(() => {
        if (!cancelled && latestAmount.current === amount) {
          appliedAmount.current = amount;
          setReadyAmount(amount);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setError(error instanceof Error ? error.message : '결제 금액을 갱신하지 못했습니다.');
      });
    return () => {
      cancelled = true;
    };
  }, [amount, initialized, widgetsRef, setReadyAmount, setError]);

  return (
    <div className="rounded-lg border bg-card px-2 py-4 shadow-sm">
      <div id="toss-payment-methods" />
      <div id="toss-payment-agreement" />
    </div>
  );
}
