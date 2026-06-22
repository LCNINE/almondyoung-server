'use client';

import { useState, useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { confirmPaymentIntent, cancelPaymentIntent, abandonPaymentIntent } from '@/lib/wallet-api';
import { isWalletSessionExpiredError, redirectToWalletLogin } from '@/lib/auth-expired';
import { buildReturnUrl } from '@/lib/return-url';
import type { AvailablePaymentMethod, PaymentIntent, PaymentMethod, PointsBalance } from '@/lib/wallet-api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Lock,
  CreditCard,
  Smartphone,
  Wallet,
  AlertCircle,
  ShoppingBag,
  ChevronRight,
  Coins,
  RefreshCw,
  Landmark,
} from 'lucide-react';

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
}

interface BankTransferPendingAction {
  type: 'BANK_TRANSFER_PENDING';
  bankName?: string;
  accountNumber?: string;
  accountHolder?: string;
  amount?: number;
  currency?: string;
}

function getMethodIcon(type: string): ReactNode {
  switch (type) {
    case 'TOSS':
      return <Smartphone className="w-5 h-5" />;
    case 'CARD':
      return <CreditCard className="w-5 h-5" />;
    case 'BALANCE':
      return <Wallet className="w-5 h-5" />;
    case 'BANK_TRANSFER':
      return <Landmark className="w-5 h-5" />;
    default:
      return <CreditCard className="w-5 h-5" />;
  }
}

// region(countryCode)별 사람이 읽는 이름. 미정의 코드는 코드 그대로(대문자) 표시한다.
const REGION_LABELS: Record<string, string> = {
  kr: '대한민국',
  jp: '일본',
  us: '미국',
};

// 빈 결제수단 안내에서 "어느 지역으로 들어왔는지"를 명확히 보여주기 위한 라벨.
// 예: jp → "일본(JP)", fr → "FR". region 이 없으면 null.
function getRegionLabel(region?: string | null): string | null {
  const code = region?.trim();
  if (!code) return null;
  const upper = code.toUpperCase();
  const name = REGION_LABELS[code.toLowerCase()];
  return name ? `${name}(${upper})` : upper;
}

function formatAmount(amount: number, currency: string): string {
  if (currency === 'KRW') {
    return `${amount.toLocaleString('ko-KR')}원`;
  }
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);
}

function buildPayPath(intentId: string, region?: string | null, extra?: Record<string, string>) {
  const params = new URLSearchParams(extra);
  if (region) params.set('region', region);
  const query = params.toString();
  return `/pay/${intentId}${query ? `?${query}` : ''}`;
}

function isBankTransferPendingAction(value: unknown): value is BankTransferPendingAction {
  return typeof value === 'object' && value !== null && (value as { type?: unknown }).type === 'BANK_TRANSFER_PENDING';
}

const TOSS_SUB_METHODS = [
  { value: 'CARD' as const, label: '카드 / 간편결제', desc: '카드, 카카오페이, 네이버페이, 토스페이 등' },
  { value: 'MOBILE_PHONE' as const, label: '휴대폰', desc: '휴대폰 소액결제' },
  { value: 'TRANSFER' as const, label: '계좌이체', desc: '실시간 계좌이체' },
  { value: 'VIRTUAL_ACCOUNT' as const, label: '가상계좌', desc: '무통장입금' },
] as const;
type TossSubMethod = (typeof TOSS_SUB_METHODS)[number]['value'];

export function PayForm({
  intent,
  methods,
  pointsBalance,
  billingMethodsExist,
  availableMethods,
  region,
  tossFailed,
}: Props) {
  const router = useRouter();
  const availableMethodMap = availableMethods ? new Map(availableMethods.map((method) => [method.code, method])) : null;
  const isAvailableInRegion = (type: string) => !availableMethodMap || availableMethodMap.has(type);
  const regionLabel = getRegionLabel(region);

  const externalMethods = methods
    .filter((m) => m.type !== 'POINTS' && isAvailableInRegion(m.type))
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
  const [usePoints, setUsePoints] = useState(false);
  const [pointsAmount, setPointsAmount] = useState(0);
  const [tossSubMethod, setTossSubMethod] = useState<TossSubMethod>('CARD');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bankTransferPending, setBankTransferPending] = useState<BankTransferPendingAction | null>(null);

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

  const isRecurring = intent.metadata?.billingMode === 'recurring';
  const isZeroAmount = intent.payableAmount === 0;
  const maxPoints = Math.min(availablePoints, intent.payableAmount);
  const remainingAmount = intent.payableAmount - (usePoints ? pointsAmount : 0);

  function handleTogglePoints(checked: boolean) {
    setUsePoints(checked);
    if (checked) {
      setPointsAmount(maxPoints);
    } else {
      setPointsAmount(0);
    }
  }

  function handlePointsAmountChange(raw: string) {
    const parsed = parseInt(raw, 10);
    if (isNaN(parsed) || parsed < 0) {
      setPointsAmount(0);
      return;
    }
    setPointsAmount(Math.min(parsed, maxPoints));
  }

  async function handleConfirm() {
    const pts = usePoints ? pointsAmount : 0;
    const remaining = intent.payableAmount - pts;
    if (remaining > 0 && !selectedMethodId) {
      setError('결제 수단을 선택해주세요.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await confirmPaymentIntent(
        intent.id,
        remaining > 0 ? selectedMethodId : null,
        pts > 0 ? pts : undefined,
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
      <div className="min-h-screen bg-muted/40">
        <div className="border-b bg-card">
          <div className="flex items-center justify-center gap-1.5 py-2.5">
            <Lock className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
        </div>

        <div className="mx-auto flex min-h-[calc(100vh-41px)] max-w-md items-center px-4 py-8">
          <Card className="w-full border shadow-sm border-border/60">
            <CardContent className="p-6 space-y-5">
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Landmark className="h-5 w-5" />
                </div>
                <div className="space-y-1">
                  <h1 className="text-lg font-semibold">입금 확인 대기 중입니다</h1>
                  <p className="text-sm text-muted-foreground">
                    아래 계좌로 입금하면 관리자가 확인한 뒤 결제가 완료됩니다.
                  </p>
                </div>
              </div>

              <Separator />

              <dl className="space-y-3 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">입금 금액</dt>
                  <dd className="font-semibold">
                    {formatAmount(
                      bankTransferPending.amount ?? remainingAmount,
                      bankTransferPending.currency ?? intent.currency,
                    )}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">은행</dt>
                  <dd className="font-medium text-right">{bankTransferPending.bankName || '-'}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">계좌번호</dt>
                  <dd className="font-mono font-medium text-right">{bankTransferPending.accountNumber || '-'}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">예금주</dt>
                  <dd className="font-medium text-right">{bankTransferPending.accountHolder || '-'}</dd>
                </div>
              </dl>

              <Alert>
                <AlertCircle className="w-4 h-4" />
                <AlertDescription>
                  입금 전에는 주문이 최종 확정되지 않습니다. 입금 확인은 관리자 승인 후 처리됩니다.
                </AlertDescription>
              </Alert>

              <Button variant="outline" className="w-full" onClick={() => router.refresh()}>
                결제 상태 새로고침
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
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
              <CardContent className="p-6 space-y-4">
                <div className="flex items-center gap-2">
                  <ShoppingBag className="w-4 h-4 text-muted-foreground" />
                  <span className="font-mono text-sm text-muted-foreground">#{intent.id.slice(-8).toUpperCase()}</span>
                </div>
                {typeof intent.metadata?.orderName === 'string' && (
                  <p className="text-sm font-medium">{intent.metadata.orderName}</p>
                )}
                {isRecurring && (
                  <div className="flex items-center gap-1.5 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-700">
                    <RefreshCw className="w-3 h-3" />
                    정기결제 · 매월 자동갱신
                  </div>
                )}
                <Separator />
                <div>
                  <p className="mb-1 text-xs text-muted-foreground">결제 금액</p>
                  <p className="text-3xl font-bold">{formatAmount(intent.payableAmount, intent.currency)}</p>
                </div>
                {intent.expiresAt && (
                  <p className="text-xs text-muted-foreground">
                    만료: {new Date(intent.expiresAt).toLocaleString('ko-KR')}
                  </p>
                )}
                <div className="flex items-center gap-1.5 pt-1">
                  <Lock className="w-3 h-3 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">SSL 암호화로 보호됩니다</span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* 우측 패널: 포인트 + 결제수단 + CTA */}
          <div className="flex-1 space-y-4">
            {/* 포인트 사용 카드 */}
            {!isZeroAmount && (
              <Card className="border shadow-sm border-border/60">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <Coins className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm font-semibold">포인트 사용</span>
                    </div>
                    <span className="text-sm text-muted-foreground">
                      보유: {availablePoints.toLocaleString('ko-KR')}P
                    </span>
                  </div>

                  {availablePoints === 0 ? (
                    <p className="text-sm text-muted-foreground">보유 포인트 없음</p>
                  ) : (
                    <div className="space-y-3">
                      <label className="flex items-center gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={usePoints}
                          onChange={(e) => handleTogglePoints(e.target.checked)}
                          className="w-4 h-4 rounded border-border"
                        />
                        <span className="text-sm">포인트 사용하기</span>
                      </label>

                      {usePoints && (
                        <div className="space-y-2 pl-7">
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min={0}
                              max={maxPoints}
                              value={pointsAmount}
                              onChange={(e) => handlePointsAmountChange(e.target.value)}
                              className="w-32 rounded-md border border-border bg-background px-3 py-1.5 text-sm"
                            />
                            <span className="text-sm text-muted-foreground">P</span>
                            <button
                              type="button"
                              onClick={() => setPointsAmount(maxPoints)}
                              className="text-xs text-primary hover:underline"
                            >
                              전액 사용
                            </button>
                          </div>
                          {remainingAmount > 0 ? (
                            <p className="text-xs text-muted-foreground">
                              {formatAmount(remainingAmount, intent.currency)} 추가 결제
                            </p>
                          ) : (
                            <p className="text-xs font-medium text-emerald-600">포인트로 전액 결제됩니다</p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* 결제수단 선택 카드 (잔액이 있을 때만 표시) */}
            {remainingAmount > 0 && (
              <Card className="border shadow-sm border-border/60">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-sm font-semibold">결제 수단 선택</span>
                    <Badge variant="secondary" className="text-xs">
                      {externalMethods.length}
                    </Badge>
                  </div>
                  {externalMethods.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 py-8 text-center">
                      <CreditCard className="w-8 h-8 text-muted-foreground/50" />
                      <p className="text-sm text-muted-foreground">
                        {Array.isArray(availableMethods)
                          ? regionLabel
                            ? `${regionLabel} 지역에서 사용 가능한 결제수단이 없습니다. 관리자에게 문의해주세요.`
                            : '이 지역에서 사용 가능한 결제수단이 없습니다. 관리자에게 문의해주세요.'
                          : '사용 가능한 결제 수단이 없습니다.'}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {externalMethods.map((m) => {
                        const isSelected = selectedMethodId === m.id;
                        return (
                          <button
                            key={m.id}
                            onClick={() => setSelectedMethodId(m.id)}
                            className={[
                              'w-full flex items-center gap-3 rounded-lg border px-4 py-3.5 text-left transition-colors',
                              isSelected
                                ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                                : 'border-border bg-background hover:bg-accent/50',
                            ].join(' ')}
                          >
                            {/* 커스텀 라디오 점 */}
                            <div
                              className={[
                                'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                                isSelected ? 'border-primary' : 'border-muted-foreground/40',
                              ].join(' ')}
                            >
                              {isSelected && <div className="h-1.5 w-1.5 rounded-full bg-primary" />}
                            </div>
                            {/* 아이콘 박스 */}
                            <div className="flex items-center justify-center rounded-md h-9 w-9 shrink-0 bg-muted text-muted-foreground">
                              {getMethodIcon(m.type)}
                            </div>
                            <span className="flex-1">
                              <span className="block text-sm font-medium">
                                {availableMethodMap?.get(m.type)?.displayName || m.displayName || m.type}
                              </span>
                              {availableMethodMap?.get(m.type)?.description && (
                                <span className="mt-0.5 block text-xs text-muted-foreground">
                                  {availableMethodMap.get(m.type)?.description}
                                </span>
                              )}
                            </span>
                            {/* 선택 시 chevron */}
                            {isSelected && <ChevronRight className="w-4 h-4 text-primary" />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Toss 결제 방식 선택 (TOSS 수단 선택 시) */}
            {remainingAmount > 0 && isTossSelected && (
              <Card className="border shadow-sm border-border/60">
                <CardContent className="p-6">
                  <span className="mb-4 block text-sm font-semibold">결제 방식 선택</span>
                  <div className="space-y-2">
                    {TOSS_SUB_METHODS.map(({ value, label, desc }) => {
                      const isSelected = tossSubMethod === value;
                      return (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setTossSubMethod(value)}
                          className={[
                            'w-full flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors',
                            isSelected
                              ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                              : 'border-border bg-background hover:bg-accent/50',
                          ].join(' ')}
                        >
                          <div
                            className={[
                              'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                              isSelected ? 'border-primary' : 'border-muted-foreground/40',
                            ].join(' ')}
                          >
                            {isSelected && <div className="h-1.5 w-1.5 rounded-full bg-primary" />}
                          </div>
                          <div>
                            <span className="text-sm font-medium">{label}</span>
                            <span className="ml-2 text-xs text-muted-foreground">{desc}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* 에러 */}
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="w-4 h-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {/* CTA */}
            <div className="space-y-2">
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
                    {formatAmount(intent.payableAmount, intent.currency)} 결제하기
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
