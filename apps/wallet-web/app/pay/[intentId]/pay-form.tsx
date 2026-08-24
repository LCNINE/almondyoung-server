'use client';

import { useState, useEffect } from 'react';
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
} from '@/lib/wallet-api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, Lock, RefreshCw, ShoppingBag } from 'lucide-react';
import {
  buildStorefrontOrderListUrl,
  formatAmount,
  formatExpiry,
  isBankTransferPendingAction,
  type BankTransferPendingAction,
} from '@/components/payment/utils';
import { PointsCard } from '@/components/payment/points-card';
import { PaymentMethodCard } from '@/components/payment/payment-method-card';
import { TossSubMethodCard, type TossSubMethod } from '@/components/payment/toss-submethod-card';
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
  /** 로그인 사용자의 사업자 정보 — 세금계산서/지출증빙 prefill 용. 없으면 null. */
  businessInfo?: BusinessLicenseInfo | null;
  /**
   * AWAITING_DEPOSIT 인텐트로 재진입했을 때 서버가 넘겨주는 발급 완료된 가상계좌.
   * 있으면 결제 폼 대신 입금 안내 화면을 바로 띄운다(취소 버튼 없는 화면).
   */
  depositAccount?: BankTransferDepositAccount | null;
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
  businessInfo,
  depositAccount,
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
  const [error, setError] = useState<string | null>(null);
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

  const isRecurring = intent.metadata?.billingMode === 'recurring';
  // 멤버십 결제(type: MEMBERSHIP_FEE)는 포인트 사용 불가 — 멤버십은 적립 혜택 대상이 아니다.
  const isZeroAmount = intent.payableAmount === 0;
  const maxPoints = Math.min(availablePoints, intent.payableAmount);
  const remainingAmount = intent.payableAmount - pointsUsed;

  async function handleConfirm() {
    const pts = pointsUsed;
    const remaining = intent.payableAmount - pts;
    if (remaining > 0 && !selectedMethodId) {
      setError('결제 수단을 선택해주세요.');
      return;
    }
    // 무통장 + 증빙 신청 검증
    let cashReceipt;
    if (isBankTransferSelected) {
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
    try {
      const result = await confirmPaymentIntent(
        intent.id,
        remaining > 0 ? selectedMethodId : null,
        pts > 0 ? pts : undefined,
        cashReceipt,
      );

      if (result.status === 'REQUIRES_ACTION' && result.nextAction?.type === 'TOSS_CHECKOUT') {
        const na = result.nextAction;
        const { loadTossPayments } = await import('@tosspayments/tosspayments-sdk');
        const tossPayments = await loadTossPayments(na.clientKey as string);
        const payment = tossPayments.payment({ customerKey: `user-${intent.userId}` });
        const tossCompletePath = buildPayPath(`${intent.id}/toss-complete`, region);
        const tossParams = {
          method: isTossSelected ? tossSubMethod : 'CARD',
          orderId: na.orderId as string,
          orderName: na.orderName as string,
          amount: { currency: 'KRW' as const, value: na.amount as number },
          successUrl: `${window.location.origin}${tossCompletePath}`,
          failUrl: `${window.location.origin}${buildPayPath(intent.id, region, { toss_fail: '1' })}`,
          ...(na.customerName ? { customerName: na.customerName as string } : {}),
          ...(na.customerEmail ? { customerEmail: na.customerEmail as string } : {}),
          ...(na.customerMobilePhone ? { customerMobilePhone: na.customerMobilePhone as string } : {}),
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await payment.requestPayment(tossParams as any);
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
      if (isWalletSessionExpiredError(err)) {
        redirectToWalletLogin();
        return;
      }

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

  const canConfirm = remainingAmount === 0 || !!selectedMethodId;

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

  return (
    <div className="min-h-screen bg-muted/40">
      {/* 상단 보안 바 */}
      <div className="border-b bg-card">
        <div className="flex items-center justify-center gap-1.5 py-2.5">
          <Lock className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
      </div>

      {/* 메인 콘텐츠 */}
      <div className="max-w-4xl px-4 py-8 mx-auto md:py-16">
        <div className="flex flex-col gap-6 md:flex-row md:gap-8 md:items-start">
          {/* 좌측 패널: 주문 요약 */}
          <div className="w-full md:w-[380px] md:shrink-0">
            <Card className="border shadow-sm border-border/60">
              <CardContent className="space-y-5 p-6">
                <div className="space-y-2">
                  {typeof intent.metadata?.orderName === 'string' && (
                    <p className="text-[17px] leading-snug font-bold break-keep text-foreground">
                      {intent.metadata.orderName}
                    </p>
                  )}
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <ShoppingBag className="h-3.5 w-3.5" />
                    <span>주문번호 {intent.id.slice(-8).toUpperCase()}</span>
                  </div>
                </div>

                {isRecurring && (
                  <div className="flex items-center gap-1.5 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-700">
                    <RefreshCw className="w-3 h-3" />
                    정기결제 · 매월 자동갱신
                  </div>
                )}

                <Separator />

                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">결제 금액</p>
                  {/* 포인트를 쓰면 실제 낼 돈은 총액이 아니다. 큰 숫자를 실결제액으로 두고
                      총액은 취소선으로 남긴다(무통장은 이 금액 그대로 입금해야 함). */}
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-3xl font-bold tracking-tight whitespace-nowrap text-foreground">
                      {formatAmount(remainingAmount, intent.currency)}
                    </span>
                    {remainingAmount !== intent.payableAmount && (
                      <span className="text-sm whitespace-nowrap line-through text-muted-foreground">
                        {formatAmount(intent.payableAmount, intent.currency)}
                      </span>
                    )}
                  </div>
                  {remainingAmount !== intent.payableAmount && (
                    <p className="text-xs font-medium text-primary">
                      포인트 {formatAmount(intent.payableAmount - remainingAmount, intent.currency)} 사용
                    </p>
                  )}
                </div>

                <div className="space-y-1.5 border-t border-border/60 pt-4 text-xs text-muted-foreground">
                  {intent.expiresAt && (
                    <p suppressHydrationWarning>{formatExpiry(intent.expiresAt)}까지 결제해주세요</p>
                  )}
                  <div className="flex items-center gap-1.5">
                    <Lock className="h-3 w-3" />
                    <span>SSL 암호화로 보호됩니다</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* 우측 패널: 포인트 + 결제수단 + CTA */}
          <div className="flex-1 space-y-4">
            {!isZeroAmount && !isMembership && (
              <PointsCard
                availablePoints={availablePoints}
                maxPoints={maxPoints}
                pointsAmount={pointsUsed}
                onAmountChange={setPointsUsed}
              />
            )}

            {/* 결제수단 선택 (잔액이 있을 때만 표시) */}
            {remainingAmount > 0 && (
              <PaymentMethodCard
                methods={externalMethods}
                availableMethodMap={availableMethodMap}
                regionFilterApplied={Array.isArray(availableMethods)}
                region={region}
                selectedMethodId={selectedMethodId}
                onSelect={setSelectedMethodId}
              />
            )}

            {remainingAmount > 0 && isTossSelected && (
              <TossSubMethodCard value={tossSubMethod} onChange={setTossSubMethod} />
            )}

            {remainingAmount > 0 && isBankTransferSelected && (
              <CashReceiptCard
                value={cashReceiptState}
                onChange={setCashReceiptState}
                userPhone={userPhone}
                userBizNumber={userBizNumber}
              />
            )}

            {/* 에러 */}
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="w-4 h-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {/* CTA */}
            {/* 모바일은 카드가 세로로 쌓여 결제 버튼이 폴드 아래로 내려간다. 하단에 고정한다. */}
            <div className="bg-background border-border sticky bottom-0 -mx-4 space-y-2 border-t px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] md:static md:mx-0 md:border-0 md:bg-transparent md:px-0 md:pt-0 md:pb-0">
              <Button
                onClick={handleConfirm}
                disabled={loading || !canConfirm}
                className="w-full h-12 text-sm font-semibold"
              >
                {loading ? (
                  <>
                    <span className="w-4 h-4 border-2 border-current rounded-full animate-spin border-t-transparent" />
                    처리 중...
                  </>
                ) : (
                  <>
                    <Lock className="w-4 h-4" />
                    {formatAmount(remainingAmount, intent.currency)} 결제하기
                  </>
                )}
              </Button>
              <div className="flex justify-center">
                <button
                  onClick={handleCancel}
                  disabled={loading}
                  className="text-sm transition-colors text-muted-foreground hover:text-foreground underline-offset-4 hover:underline disabled:opacity-50"
                >
                  취소하기
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
