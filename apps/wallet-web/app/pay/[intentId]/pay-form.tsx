'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  confirmPaymentIntent,
  cancelPaymentIntent,
  abandonPaymentIntent,
  saveMyBusinessNumber,
} from '@/lib/wallet-api';
import { isWalletSessionExpiredError, redirectToWalletLogin } from '@/lib/auth-expired';
import { buildReturnUrl } from '@/lib/return-url';
import type {
  AvailablePaymentMethod,
  BankTransferDepositAccount,
  BusinessLicenseInfo,
  PaymentIntent,
  PaymentMethod,
  PointsBalance,
  TossWidgetConfig,
} from '@/lib/wallet-api';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, RefreshCw } from 'lucide-react';
import {
  buildStorefrontOrderListUrl,
  formatAmount,
  formatExpiry,
  isBankTransferPendingAction,
  type BankTransferPendingAction,
} from '@/components/payment/utils';
import { CheckoutPoints } from '@/components/payment/checkout-points';
import { CheckoutFrame } from '@/components/payment/checkout-frame';
import { PaymentMethodCard } from '@/components/payment/payment-method-card';
import { TossSubMethodCard, type TossSubMethod } from '@/components/payment/toss-submethod-card';
import { TossPaymentWidget } from '@/components/payment/toss-payment-widget';
import { CustomTossCheckout } from '@/components/payment/custom-toss-checkout';
import type { CheckoutSelection } from '@/components/payment/card-checkout';
import type { TossPaymentsBrandpay, TossPaymentsWidgets } from '@tosspayments/tosspayments-sdk';
import {
  CashReceiptCard,
  EMPTY_CASH_RECEIPT,
  buildCashReceipt,
  saveCashReceiptPreference,
  type CashReceiptState,
} from '@/components/payment/cash-receipt-card';
import { BankTransferPending } from '@/components/payment/bank-transfer-pending';

interface Props {
  intent: PaymentIntent;
  methods: PaymentMethod[];
  pointsBalance: PointsBalance;
  billingMethodsExist: boolean;
  /**
   * 리전에서 사용 가능한 결제수단 목록. storefront 가 region 을 전달했을 때만 채워진다.
   * null 이면 리전 필터를 적용하지 않는다.
   */
  availableMethods?: AvailablePaymentMethod[] | null;
  region?: string | null;
  /** Toss 결제가 실패/취소로 돌아왔을 때(failUrl ?toss_fail=1) true. mount 시 abandon 신호 전송. */
  tossFailed?: boolean;
  brandpayFailed?: boolean;
  /** 로그인 사용자의 사업자 정보 — 세금계산서/지출증빙 prefill 용. 없으면 null. */
  businessInfo?: BusinessLicenseInfo | null;
  /**
   * AWAITING_DEPOSIT 인텐트로 재진입했을 때 서버가 넘겨주는 발급 완료된 가상계좌.
   * 있으면 결제 폼 대신 입금 안내 화면을 바로 띄운다(취소 버튼 없는 화면).
   */
  depositAccount?: BankTransferDepositAccount | null;
  tossWidgetConfig?: TossWidgetConfig | null;
}

function buildPayPath(intentId: string, region?: string | null, extra?: Record<string, string>) {
  const params = new URLSearchParams(extra);
  if (region) params.set('region', region);
  const query = params.toString();
  return `/pay/${intentId}${query ? `?${query}` : ''}`;
}

export function PayForm({
  intent,
  methods,
  pointsBalance,
  billingMethodsExist,
  availableMethods,
  region,
  tossFailed,
  brandpayFailed,
  businessInfo,
  depositAccount,
  tossWidgetConfig,
}: Props) {
  const router = useRouter();
  const availableMethodMap = availableMethods ? new Map(availableMethods.map((method) => [method.code, method])) : null;
  const isAvailableInRegion = (type: string) => !availableMethodMap || availableMethodMap.has(type);

  // 멤버십(MEMBERSHIP_FEE)은 무통장(가상계좌) 결제만 허용한다 — 카드/간편결제 비노출.
  // 무통장은 자동갱신 불가라 멤버십은 1회결제로만 굴러가며, 정기결제(CMS 등)는 추후 별도 경로.
  const isMembership = intent.metadata?.type === 'MEMBERSHIP_FEE';

  const externalMethods = methods
    .filter((m) => m.type !== 'POINTS' && isAvailableInRegion(m.type))
    .filter((m) => !isMembership || m.type === 'BANK_TRANSFER')
    .sort((a, b) => {
      const aOrder = availableMethodMap?.get(a.type)?.sortOrder ?? 0;
      const bOrder = availableMethodMap?.get(b.type)?.sortOrder ?? 0;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.type.localeCompare(b.type);
    });

  // 포인트는 리전이 POINTS 를 허용할 때만 사용 가능.
  const pointsAllowedInRegion = isAvailableInRegion('POINTS');
  const availablePoints = pointsAllowedInRegion ? pointsBalance.available : 0;

  const [selectedMethodId, setSelectedMethodId] = useState<string>(externalMethods[0]?.id ?? '');
  const [pointsUsed, setPointsUsed] = useState(0);
  const [tossSubMethod, setTossSubMethod] = useState<TossSubMethod>('CARD');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(
    brandpayFailed ? '브랜드페이 인증을 완료하지 못했습니다. 다시 시도해주세요.' : null,
  );
  const tossWidgetsRef = useRef<TossPaymentsWidgets | null>(null);
  const [tossWidgetReadyAmount, setTossWidgetReadyAmount] = useState<number | null>(null);
  // 재진입(AWAITING_DEPOSIT)이면 서버가 넘긴 계좌로 초기화 → 안내 화면이 그대로 복원된다.
  const [bankTransferPending, setBankTransferPending] = useState<BankTransferPendingAction | null>(
    depositAccount
      ? {
          type: 'BANK_TRANSFER_PENDING',
          bankName: depositAccount.bankName ?? undefined,
          accountNumber: depositAccount.accountNumber ?? undefined,
          accountHolder: depositAccount.accountHolder ?? undefined,
          amount: depositAccount.amount,
          currency: depositAccount.currency,
        }
      : null,
  );
  // 증빙 신청 (무통장입금 시) — 현금영수증만. 입금확인 완료 시 자동 발급.
  const [cashReceiptState, setCashReceiptState] = useState<CashReceiptState>(EMPTY_CASH_RECEIPT);

  const userPhone = (businessInfo?.phoneNumber ?? '').replace(/[^0-9]/g, '');
  const userBizNumber = businessInfo?.businessNumber ?? '';

  // Toss 결제 실패/취소로 돌아온 경우(failUrl ?toss_fail=1) abandon 신호를 보내 REQUIRES_ACTION 으로
  // 묶인 포인트 hold 를 즉시 해제하고 intent 를 CREATED 로 soft reset 한다. best-effort — 실패해도
  // 만료 job 이 안전망. 처리 후 toss_fail 파라미터를 제거(replace)해 재실행을 막고 서버 데이터를 다시 읽는다.
  useEffect(() => {
    if (!tossFailed) return;
    let cancelled = false;
    void (async () => {
      try {
        await abandonPaymentIntent(intent.id);
      } catch {
        // best-effort: 만료 job 이 안전망이므로 무시한다.
      }
      if (!cancelled) {
        router.replace(buildPayPath(intent.id, region));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tossFailed, intent.id, region, router]);

  const isTossSelected = externalMethods.find((m) => m.id === selectedMethodId)?.type === 'TOSS';
  const isBankTransferSelected = externalMethods.find((m) => m.id === selectedMethodId)?.type === 'BANK_TRANSFER';

  const methodExtrasRef = useRef<HTMLDivElement>(null);

  const revealMethodExtras = () => {
    setTimeout(() => {
      const el = methodExtrasRef.current;
      if (el?.childElementCount) el.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, 0);
  };

  const handleSelectMethod = (id: string) => {
    setSelectedMethodId(id);
    revealMethodExtras();
  };

  // 증빙을 신청하면 입력 폼이 펼쳐지면서 고정 CTA 뒤로 밀린다. 같이 끌어올린다.
  const handleCashReceiptChange = (next: CashReceiptState) => {
    if (next.evidenceType !== cashReceiptState.evidenceType) revealMethodExtras();
    setCashReceiptState(next);
  };

  const isRecurring = intent.metadata?.billingMode === 'recurring';
  // 멤버십 결제(type: MEMBERSHIP_FEE)는 포인트 사용 불가 — 멤버십은 적립 혜택 대상이 아니다.
  const isZeroAmount = intent.payableAmount === 0;
  const maxPoints = Math.min(availablePoints, intent.payableAmount);
  const remainingAmount = intent.payableAmount - pointsUsed;

  async function handleConfirm(selection?: CheckoutSelection, brandpay?: TossPaymentsBrandpay) {
    const custom = tossWidgetConfig?.checkoutMode === 'CUSTOM' && !!selection;
    const pts = selection ? Math.min(maxPoints, Math.max(0, selection.points)) : pointsUsed;
    const methodId = custom ? externalMethods.find((method) => method.type === 'TOSS')?.id : selectedMethodId;
    const remaining = intent.payableAmount - pts;
    if (remaining > 0 && !methodId) {
      setError('결제 수단을 선택해주세요.');
      return;
    }
    if (
      !custom &&
      isTossSelected &&
      tossWidgetConfig &&
      (tossWidgetReadyAmount !== remaining || !tossWidgetsRef.current)
    ) {
      setError('토스 결제 UI를 준비하고 있습니다. 잠시 후 다시 시도해주세요.');
      return;
    }
    // 무통장 + 증빙 신청 검증
    let cashReceipt;
    if (!custom && isBankTransferSelected) {
      const built = buildCashReceipt(cashReceiptState, userBizNumber);
      if (!built.ok) {
        setError(built.error);
        return;
      }
      cashReceipt = built.cashReceipt;
      // 비어있을 때만 채우는 self-endpoint 라 best-effort — 결제 흐름을 막지 않는다.
      saveCashReceiptPreference(cashReceiptState);
      if (built.offerSaveBizNumber && cashReceipt) {
        void saveMyBusinessNumber(cashReceipt.customerIdentityNumber);
      }
    }
    setLoading(true);
    setError(null);
    let tossActionStarted = false;
    try {
      const result = await confirmPaymentIntent(
        intent.id,
        remaining > 0 ? methodId! : null,
        pts > 0 ? pts : undefined,
        cashReceipt,
      );

      if (result.status === 'REQUIRES_ACTION' && result.nextAction?.type === 'TOSS_CHECKOUT') {
        tossActionStarted = true;
        const na = result.nextAction;
        const tossCompletePath = buildPayPath(`${intent.id}/toss-complete`, region);
        const tossParams = {
          orderId: na.orderId as string,
          orderName: na.orderName as string,
          successUrl: `${window.location.origin}${tossCompletePath}`,
          failUrl: `${window.location.origin}${buildPayPath(intent.id, region, { toss_fail: '1' })}`,
          ...(na.customerName ? { customerName: na.customerName as string } : {}),
          ...(na.customerEmail ? { customerEmail: na.customerEmail as string } : {}),
          ...(na.customerMobilePhone ? { customerMobilePhone: na.customerMobilePhone as string } : {}),
        };
        if (custom && selection?.method === 'BRANDPAY') {
          if (!brandpay || !selection.cardId) throw new Error('결제할 카드를 선택해주세요.');
          await brandpay.requestPayment({
            ...tossParams,
            successUrl: `${tossParams.successUrl}${tossParams.successUrl.includes('?') ? '&' : '?'}paymentType=BRANDPAY`,
            amount: { currency: 'KRW', value: na.amount as number },
            methodId: selection.cardId,
            card: { cardInstallmentPlan: selection.installment },
          });
        } else if (!custom && isTossSelected && tossWidgetConfig) {
          if (na.amount !== tossWidgetReadyAmount || !tossWidgetsRef.current) {
            throw new Error('결제 금액이 변경되었습니다. 화면을 새로고침한 뒤 다시 시도해주세요.');
          }
          await tossWidgetsRef.current.requestPayment(tossParams);
        } else {
          const { loadTossPayments } = await import('@tosspayments/tosspayments-sdk');
          const tossPayments = await loadTossPayments(na.clientKey as string);
          const payment = tossPayments.payment({
            customerKey: custom ? tossWidgetConfig.customerKey : `user-${intent.userId}`,
          });
          // 화면의 한글 명칭 대신 API 버전에 관계없이 사용할 수 있는 간편결제 코드를 전달한다.
          const easyPay = {
            카카오페이: 'KAKAOPAY',
            네이버페이: 'NAVERPAY',
            토스페이: 'TOSSPAY',
          }[selection?.method ?? ''];
          await payment.requestPayment({
            ...tossParams,
            method: custom ? ('CARD' as const) : isTossSelected ? tossSubMethod : ('CARD' as const),
            amount: { currency: 'KRW' as const, value: na.amount as number },
            ...(custom && easyPay ? { card: { flowMode: 'DIRECT' as const, easyPay } } : {}),
          });
        }
        return; // requestPayment redirects
      }

      // 무통장: confirm 응답 status는 이제 AWAITING_DEPOSIT이므로 status가 아니라
      // nextAction 타입(BANK_TRANSFER_PENDING)으로 판별한다.
      if (isBankTransferPendingAction(result.nextAction)) {
        setBankTransferPending(result.nextAction);
        return;
      }

      if (result.status === 'REQUIRES_ACTION') {
        setError('추가 인증이 필요한 결제수단이지만 wallet-web에서 아직 지원하지 않습니다.');
        return;
      }

      if (result.returnUrl) {
        const successUrl = buildReturnUrl(result.returnUrl, {
          payment_intent_id: intent.id,
          status: 'succeeded',
        });
        if (isRecurring && !billingMethodsExist) {
          const params = new URLSearchParams({ returnUrl: successUrl });
          router.replace(`/pay/${intent.id}/billing-setup?${params}`);
        } else {
          router.replace(successUrl);
        }
      } else {
        router.replace(buildPayPath(intent.id, region));
      }
    } catch (err) {
      if (tossActionStarted) await abandonPaymentIntent(intent.id).catch(() => undefined);
      if (isWalletSessionExpiredError(err)) {
        redirectToWalletLogin();
        return;
      }

      if (err && typeof err === 'object' && 'code' in err && err.code === 'USER_CANCEL') return;

      setError(err instanceof Error ? err.message : '결제에 실패했어요.');
    } finally {
      setLoading(false);
    }
  }

  async function handleCancel() {
    setLoading(true);
    setError(null);
    try {
      await cancelPaymentIntent(intent.id);
      if (intent.returnUrl) {
        router.replace(
          buildReturnUrl(intent.returnUrl, {
            payment_intent_id: intent.id,
            status: 'canceled',
          }),
        );
      } else {
        router.replace(buildPayPath(intent.id, region));
      }
    } catch (err) {
      if (isWalletSessionExpiredError(err)) {
        redirectToWalletLogin();
        return;
      }

      setError(err instanceof Error ? err.message : '취소에 실패했어요.');
    } finally {
      setLoading(false);
    }
  }

  const canConfirm =
    (remainingAmount === 0 || !!selectedMethodId) &&
    (!isTossSelected || !tossWidgetConfig || tossWidgetReadyAmount === remainingAmount);

  if (bankTransferPending) {
    return (
      <BankTransferPending
        pending={bankTransferPending}
        fallbackAmount={remainingAmount}
        fallbackCurrency={intent.currency}
        orderListUrl={buildStorefrontOrderListUrl(intent.returnUrl, region)}
        onRefresh={() => router.refresh()}
      />
    );
  }

  if (
    !isMembership &&
    tossWidgetConfig?.checkoutMode === 'CUSTOM' &&
    externalMethods.some((method) => method.type === 'TOSS')
  ) {
    return (
      <CustomTossCheckout
        customer={businessInfo}
        key={intent.id}
        intentId={intent.id}
        orderName={typeof intent.metadata?.orderName === 'string' ? intent.metadata.orderName : '주문 결제'}
        amount={intent.payableAmount}
        availablePoints={availablePoints}
        config={tossWidgetConfig}
        loading={loading}
        error={error}
        onClose={() => void handleCancel()}
        onPay={handleConfirm}
      />
    );
  }

  return (
    <CheckoutFrame
      orderName={typeof intent.metadata?.orderName === 'string' ? intent.metadata.orderName : '주문 결제'}
      originalPrice={formatAmount(intent.payableAmount, intent.currency)}
      finalPrice={formatAmount(remainingAmount, intent.currency)}
      discounted={remainingAmount < intent.payableAmount}
      onClose={() => void handleCancel()}
      footer={
        <>
          <p aria-live="polite" className="text-sm text-muted-foreground">
            {remainingAmount === 0
              ? '포인트로 전액 결제'
              : pointsUsed > 0
                ? `포인트 ${pointsUsed.toLocaleString('ko-KR')}P 사용`
                : '총 결제금액'}
          </p>
          <Button
            onClick={() => void handleConfirm()}
            disabled={loading || !canConfirm}
            className="h-14 w-full rounded-xl text-lg font-bold"
          >
            {loading ? (
              <>
                <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                처리 중...
              </>
            ) : (
              `${formatAmount(remainingAmount, intent.currency)} 결제하기`
            )}
          </Button>
          <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
            주문 내용을 확인했으며, 결제 서비스 이용에 동의합니다.
          </p>
        </>
      }
    >
      {isRecurring && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <RefreshCw className="size-3" />
          정기결제 · 매월 자동갱신
        </p>
      )}
      {remainingAmount > 0 && (externalMethods.length > 1 || !tossWidgetConfig) && (
        <PaymentMethodCard
          methods={externalMethods}
          availableMethodMap={availableMethodMap}
          regionFilterApplied={Array.isArray(availableMethods)}
          region={region}
          selectedMethodId={selectedMethodId}
          onSelect={handleSelectMethod}
        />
      )}
      <div ref={methodExtrasRef} className="empty:hidden space-y-4 scroll-mb-44">
        {remainingAmount > 0 && isTossSelected && tossWidgetConfig && (
          <TossPaymentWidget
            intentId={intent.id}
            clientKey={tossWidgetConfig.clientKey}
            variantKey={tossWidgetConfig.variantKey}
            customerKey={tossWidgetConfig.customerKey}
            amount={remainingAmount}
            widgetsRef={tossWidgetsRef}
            setReadyAmount={setTossWidgetReadyAmount}
            setError={setError}
          />
        )}
        {remainingAmount > 0 && isTossSelected && !tossWidgetConfig && (
          <TossSubMethodCard value={tossSubMethod} onChange={setTossSubMethod} />
        )}
        {remainingAmount > 0 && isBankTransferSelected && (
          <CashReceiptCard
            value={cashReceiptState}
            onChange={handleCashReceiptChange}
            userPhone={userPhone}
            userBizNumber={userBizNumber}
          />
        )}
      </div>
      {!isZeroAmount && !isMembership && (
        <CheckoutPoints
          availablePoints={availablePoints}
          maxPoints={maxPoints}
          points={pointsUsed}
          onChange={setPointsUsed}
        />
      )}
      <section aria-label="결제 금액" className="border-t border-border/60 bg-white py-5">
        <h2 className="font-bold">결제 금액</h2>
        <dl className="mt-4 space-y-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">주문 금액</dt>
            <dd>{formatAmount(intent.payableAmount, intent.currency)}</dd>
          </div>
          {pointsUsed > 0 && (
            <div className="flex justify-between">
              <dt className="text-muted-foreground">포인트 사용</dt>
              <dd className="text-primary">−{formatAmount(pointsUsed, intent.currency)}</dd>
            </div>
          )}
          <div className="flex justify-between border-t border-border/50 pt-3 font-bold">
            <dt>최종 결제 금액</dt>
            <dd>{formatAmount(remainingAmount, intent.currency)}</dd>
          </div>
        </dl>
      </section>
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="space-y-1 text-center text-xs text-muted-foreground">
        <p>주문번호 {intent.id.slice(-8).toUpperCase()}</p>
        {intent.expiresAt && <p suppressHydrationWarning>{formatExpiry(intent.expiresAt)}까지 결제해주세요</p>}
        <button
          type="button"
          onClick={() => void handleCancel()}
          disabled={loading}
          className="min-h-10 underline underline-offset-4 disabled:opacity-50"
        >
          취소하기
        </button>
      </div>
    </CheckoutFrame>
  );
}
