'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Banknote, Clock, Info } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CustomsCodeSection } from '@/checkout-ui/domains/checkout/components/sections/customs-code';
import { DiscountSection } from '@/checkout-ui/domains/checkout/components/sections/discount';
import {
  OrderConsentSection,
  type OrderConsentState,
} from '@/checkout-ui/domains/checkout/components/sections/order-consent';
import { OrderProductsSection } from '@/checkout-ui/domains/checkout/components/sections/order-products-shipping';
import { PaymentTotalSection } from '@/checkout-ui/domains/checkout/components/sections/payment-total';
import { ShippingSection } from '@/checkout-ui/domains/checkout/components/sections/shipping';
import type { ShippingMemo } from '@/checkout-ui/domains/checkout/components/sections/shipping/types';
import {
  isSameShippingMemo,
  readShippingMemo,
} from '@/checkout-ui/domains/checkout/components/sections/shipping/utils';
import {
  cartHasOverseasItem,
  isValidPersonalCustomsCode,
} from '@/checkout-ui/domains/checkout/utils/customs';
import { MobileCTA, PCFixedCTA } from '@/checkout-ui/domains/checkout/components/cta';
import { MobileHeader, PCHeader } from '@/checkout-ui/domains/checkout/components/header';
import { cartRequiresShipping } from '@/checkout-ui/lib/api/medusa/shipping-method-policy';
import type { CartResponseDto } from '@/checkout-ui/lib/types/dto/medusa';
import type { CartTotals, ShippingInfo } from '@/checkout-ui/lib/types/ui/cart';
import type { Promotion } from '@/checkout-ui/lib/types/ui/promotion';
import { calculateMembershipDiscount, getCartTotals } from '@/checkout-ui/lib/utils/price-utils';

import type { AvailablePaymentMethod, BusinessLicenseInfo, PaymentMethod, PointsBalance } from '@/lib/wallet-api';
import { abandonPaymentIntent, confirmPaymentIntent } from '@/lib/wallet-api';
import { isWalletSessionExpiredError, redirectToWalletLogin } from '@/lib/auth-expired';
import { PointsCard } from '@/components/payment/points-card';
import { PaymentMethodCard } from '@/components/payment/payment-method-card';
import { TossSubMethodCard, type TossSubMethod } from '@/components/payment/toss-submethod-card';
import { CashReceiptCard } from '@/components/payment/cash-receipt-card';
import { buildCashReceipt, EMPTY_CASH_RECEIPT, type CashReceiptState } from '@/components/payment/cash-receipt';
import { BankTransferPending } from '@/components/payment/bank-transfer-pending';
import { isBankTransferPendingAction, type BankTransferPendingAction } from '@/components/payment/utils';
import { saveMyBusinessNumber } from '@/lib/wallet-api';

import { prepareCheckout } from './actions';
import { finalizeOrder } from './finalize';

interface Props {
  cart: CartResponseDto['cart'];
  cartId: string;
  countryCode: string;
  shipping: ShippingInfo;
  promotions: Promotion[];
  isMembership: boolean;
  methods: PaymentMethod[];
  availableMethods: AvailablePaymentMethod[] | null;
  pointsBalance: PointsBalance;
  businessInfo: BusinessLicenseInfo | null;
  /** 결제 완료·주문내역 복귀용 storefront origin (서버 전용 env 라 props 로 내려받는다). */
  storefrontOrigin: string;
  /** 토스 결제창에서 실패/취소로 돌아온 인텐트. 있으면 mount 시 포인트 hold 를 풀어준다. */
  abandonIntentId: string | null;
}

export function CheckoutForm({
  cart,
  cartId,
  countryCode,
  shipping,
  promotions,
  isMembership,
  methods,
  availableMethods,
  pointsBalance,
  businessInfo,
  storefrontOrigin,
  abandonIntentId,
}: Props) {
  const router = useRouter();
  const tProcess = useTranslations('checkout.process');
  const tCustoms = useTranslations('checkout.customsCode');
  const tConsent = useTranslations('checkout.consent');
  const tNotice = useTranslations('checkout.notice');

  const cartItems = useMemo(() => cart?.items ?? [], [cart]);
  const requiresShipping = useMemo(() => cartRequiresShipping(cartItems), [cartItems]);

  const [shippingMemo, setShippingMemo] = useState<ShippingMemo>(() => readShippingMemo(cart?.metadata));
  const handleShippingMemoChange = useCallback((memo: ShippingMemo) => setShippingMemo(memo), []);

  const hasOverseasItem = useMemo(() => cartHasOverseasItem(cart), [cart]);
  const [personalCustomsCode, setPersonalCustomsCode] = useState<string>(
    () => (cart?.shipping_address?.metadata?.personalCustomsCode as string) || '',
  );
  const [customsCodeError, setCustomsCodeError] = useState<string | null>(null);
  const handleCustomsCodeChange = useCallback((value: string) => {
    setPersonalCustomsCode(value);
    setCustomsCodeError(null);
  }, []);

  const [consent, setConsent] = useState<OrderConsentState>({ purchaseTerms: false, personalInfo: false });
  const consentGiven = consent.purchaseTerms && consent.personalInfo;

  // ── 결제수단 (기존 /pay 화면에서 합류) ──
  const availableMethodMap = availableMethods ? new Map(availableMethods.map((m) => [m.code, m])) : null;
  const isAvailableInRegion = (type: string) => !availableMethodMap || availableMethodMap.has(type);

  const externalMethods = useMemo(
    () =>
      methods
        .filter((m) => m.type !== 'POINTS' && isAvailableInRegion(m.type))
        .sort((a, b) => {
          const aOrder = availableMethodMap?.get(a.type)?.sortOrder ?? 0;
          const bOrder = availableMethodMap?.get(b.type)?.sortOrder ?? 0;
          if (aOrder !== bOrder) return aOrder - bOrder;
          return a.type.localeCompare(b.type);
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [methods, availableMethods],
  );

  const [selectedMethodId, setSelectedMethodId] = useState<string>(externalMethods[0]?.id ?? '');
  const [tossSubMethod, setTossSubMethod] = useState<TossSubMethod>('CARD');
  const [cashReceiptState, setCashReceiptState] = useState<CashReceiptState>(EMPTY_CASH_RECEIPT);
  const [bankTransferPending, setBankTransferPending] = useState<BankTransferPendingAction | null>(null);

  const selectedType = externalMethods.find((m) => m.id === selectedMethodId)?.type;
  const isTossSelected = selectedType === 'TOSS';
  const isBankTransferSelected = selectedType === 'BANK_TRANSFER';

  // 원본 storefront checkout-template 과 동일한 계산. 최종 결제금액은 Medusa 권위값(total)을 쓴다.
  const cartTotals: CartTotals = useMemo(() => {
    const { currency_code, item_subtotal, discount_subtotal, total } = getCartTotals(cart);

    const membershipDiscount = isMembership && cartItems.length > 0 ? calculateMembershipDiscount(cartItems) : 0;
    const original_item_subtotal = item_subtotal + membershipDiscount;
    const effectiveShipping = requiresShipping ? shipping.amount : 0;

    // 배송비 그룹이 2개 이상이면 배송 방법도 그룹당 1개씩 붙는다. 합계만 보여주면 어느 상품
    // 몫인지 알 수 없으니 그룹별 금액을 같이 내려보낸다.
    const shippingBreakdown = requiresShipping
      ? (cart.shipping_methods ?? []).map((method) => ({
          id: method.id,
          name: method.name ?? '',
          amount: method.amount ?? 0,
        }))
      : [];

    return {
      currency_code,
      item_subtotal,
      original_item_subtotal,
      shipping: effectiveShipping,
      shippingBreakdown,
      discount_subtotal,
      membershipDiscount,
      pointsUsed: 0,
      totalDiscount: discount_subtotal,
      finalTotal: total,
    };
  }, [cart, cartItems, shipping, isMembership, requiresShipping]);

  // 포인트는 리전이 허용할 때만.
  const availablePoints = isAvailableInRegion('POINTS') ? pointsBalance.available : 0;
  const [usePoints, setUsePoints] = useState(false);
  const [pointsAmount, setPointsAmount] = useState(0);
  const maxPoints = Math.min(availablePoints, cartTotals.finalTotal);
  const pointsUsed = usePoints ? pointsAmount : 0;
  const remainingAmount = cartTotals.finalTotal - pointsUsed;

  function handleTogglePoints(checked: boolean) {
    setUsePoints(checked);
    setPointsAmount(checked ? maxPoints : 0);
  }

  const [loading, setLoading] = useState(false);

  // 토스 결제창에서 실패/취소로 돌아왔다면 REQUIRES_ACTION 에 묶인 포인트 hold 를 즉시 풀고
  // 인텐트를 CREATED 로 되돌린다. best-effort — 실패해도 만료 job 이 안전망이다.
  // 처리 후 쿼리를 지워 재실행을 막는다.
  useEffect(() => {
    if (!abandonIntentId) return;
    let cancelled = false;
    void (async () => {
      try {
        await abandonPaymentIntent(abandonIntentId);
      } catch {
        // 무시 — 만료 job 이 회수한다.
      }
      if (!cancelled) router.replace('/checkout');
    })();
    return () => {
      cancelled = true;
    };
  }, [abandonIntentId, router]);

  const userPhone = (businessInfo?.phoneNumber ?? '').replace(/[^0-9]/g, '');
  const userBizNumber = businessInfo?.businessNumber ?? '';

  function validate(): boolean {
    if (requiresShipping) {
      if (!cart?.shipping_address?.address_1) {
        toast.error(tProcess('toasts.enterAddress'));
        return false;
      }
      if (!shippingMemo.type) {
        toast.error(tProcess('toasts.selectMemo'));
        return false;
      }
      if (shippingMemo.type === 'door' && shippingMemo.hasEntrance && !shippingMemo.entrancePassword.trim()) {
        toast.error(tProcess('toasts.enterEntrancePw'));
        return false;
      }
    }
    if (hasOverseasItem && !isValidPersonalCustomsCode(personalCustomsCode)) {
      setCustomsCodeError(tCustoms('error'));
      toast.error(tCustoms('error'));
      return false;
    }
    if (!consentGiven) {
      toast.error(tConsent('required'));
      return false;
    }
    if (remainingAmount > 0 && !selectedMethodId) {
      toast.error('결제 수단을 선택해주세요.');
      return false;
    }
    return true;
  }

  async function handlePayment() {
    if (loading) return;
    if (!validate()) return;

    // 무통장 증빙 입력 검증 — 결제 인텐트를 만들기 전에 막는다.
    let cashReceipt;
    if (isBankTransferSelected) {
      const built = buildCashReceipt(cashReceiptState, userBizNumber);
      if (!built.ok) {
        toast.error(built.error);
        return;
      }
      cashReceipt = built.cashReceipt;
      if (
        built.offerSaveBizNumber &&
        cashReceipt &&
        window.confirm('입력하신 사업자번호를 저장할까요?\n다음 결제부터 자동으로 입력됩니다.')
      ) {
        void saveMyBusinessNumber(cashReceipt.customerIdentityNumber);
      }
    }

    setLoading(true);
    try {
      const firstTitle = cartItems[0]?.title ?? tProcess('productFallback');
      const orderName =
        cartItems.length <= 1
          ? tProcess('orderNameSingle', { title: firstTitle })
          : tProcess('orderNameMultiple', { title: firstTitle, count: cartItems.length - 1 });

      const prepared = await prepareCheckout({
        cartId,
        region: countryCode,
        requiresShipping,
        shippingMemo,
        memoChanged: !isSameShippingMemo(shippingMemo, readShippingMemo(cart?.metadata)),
        personalCustomsCode: hasOverseasItem ? personalCustomsCode : null,
        orderName,
        displayedTotal: cartTotals.finalTotal,
      });

      if (!prepared.ok) {
        toast.error(prepared.message);
        if (prepared.code === 'AMOUNT_CHANGED' || prepared.code === 'UNAVAILABLE_ITEMS') {
          router.refresh();
        }
        setLoading(false);
        return;
      }

      const result = await confirmPaymentIntent(
        prepared.intentId,
        remainingAmount > 0 ? selectedMethodId : null,
        pointsUsed > 0 ? pointsUsed : undefined,
        cashReceipt,
      );

      if (result.status === 'REQUIRES_ACTION' && result.nextAction?.type === 'TOSS_CHECKOUT') {
        const na = result.nextAction;
        const { loadTossPayments } = await import('@tosspayments/tosspayments-sdk');
        const tossPayments = await loadTossPayments(na.clientKey as string);
        const payment = tossPayments.payment({ customerKey: `user-${na.userId as string}` });
        const tossParams = {
          method: isTossSelected ? tossSubMethod : 'CARD',
          orderId: na.orderId as string,
          orderName: na.orderName as string,
          amount: { currency: 'KRW' as const, value: na.amount as number },
          successUrl: `${window.location.origin}/checkout/toss-complete?intent=${prepared.intentId}`,
          failUrl: `${window.location.origin}/checkout?toss_fail=1&intent=${prepared.intentId}`,
          ...(na.customerName ? { customerName: na.customerName as string } : {}),
          ...(na.customerEmail ? { customerEmail: na.customerEmail as string } : {}),
          ...(na.customerMobilePhone ? { customerMobilePhone: na.customerMobilePhone as string } : {}),
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await payment.requestPayment(tossParams as any);
        return; // requestPayment 가 리다이렉트한다
      }

      // 무통장은 여기서 끝난다 — 주문은 입금 확인 웹훅이 만든다. finalizeOrder 를 부르면 안 된다.
      if (isBankTransferPendingAction(result.nextAction)) {
        setBankTransferPending(result.nextAction);
        setLoading(false);
        return;
      }

      if (result.status === 'REQUIRES_ACTION') {
        toast.error('추가 인증이 필요한 결제수단은 아직 지원하지 않아요.');
        setLoading(false);
        return;
      }

      // 포인트 전액/0원 결제 — 승인이 이미 끝났으니 바로 주문을 확정한다.
      const finalized = await finalizeOrder(prepared.intentId);
      if (finalized.type === 'error') {
        router.replace(`/checkout/failed?intent=${prepared.intentId}`);
        return;
      }
      window.location.href = buildSuccessUrl(
        storefrontOrigin,
        countryCode,
        prepared.intentId,
        finalized.type === 'order' ? finalized.orderId : undefined,
      );
    } catch (err) {
      if (isWalletSessionExpiredError(err)) {
        redirectToWalletLogin();
        return;
      }
      toast.error(err instanceof Error ? err.message : tProcess('toasts.unknownError'));
      setLoading(false);
    }
  }

  if (bankTransferPending) {
    return (
      <BankTransferPending
        pending={bankTransferPending}
        fallbackAmount={remainingAmount}
        fallbackCurrency={cart.currency_code ?? 'KRW'}
        orderListUrl={`${storefrontOrigin}/${countryCode}/mypage/order/list?justOrdered=1`}
        onRefresh={() => router.refresh()}
      />
    );
  }

  const totalsWithPoints = { ...cartTotals, pointsUsed, finalTotal: remainingAmount };

  return (
    <main className="w-full min-h-screen bg-muted">
      <PCHeader />

      <div className="container px-4 mx-auto lg:px-[40px] lg:py-8">
        <MobileHeader onClose={() => router.back()} />

        <div className="mx-auto lg:max-w-[820px]">
          {requiresShipping && (
            <ShippingSection
              cartId={cartId}
              shippingAddress={cart?.shipping_address || null}
              addressName={cart?.metadata?.shipping_address_name as string | null}
              shippingMemo={shippingMemo}
              onShippingMemoChange={handleShippingMemoChange}
            />
          )}

          {hasOverseasItem && (
            <CustomsCodeSection
              value={personalCustomsCode}
              onChange={handleCustomsCodeChange}
              error={customsCodeError}
            />
          )}

          <OrderProductsSection
            products={cartItems}
            shipping={requiresShipping ? shipping.amount : 0}
            shippingMethods={cartTotals.shippingBreakdown}
          />

          <DiscountSection
            cartId={cartId}
            isMembership={isMembership}
            membershipDiscount={cartTotals.membershipDiscount}
            itemSubtotal={cartTotals.item_subtotal}
            cartDiscountTotal={cartTotals.discount_subtotal}
            shipping={shipping}
            promotions={promotions}
            appliedPromotionCode={cart.promotions?.[0]?.code}
            onCouponApplied={() => router.refresh()}
          />

          {/* 여기부터가 기존 /pay 화면에서 합류한 부분 — 도메인을 한 번 더 건널 필요가 없어졌다. */}
          {remainingAmount > 0 && (
            <div className="mb-4">
              <PaymentMethodCard
                methods={externalMethods}
                availableMethodMap={availableMethodMap}
                regionFilterApplied={Array.isArray(availableMethods)}
                region={countryCode}
                selectedMethodId={selectedMethodId}
                onSelect={setSelectedMethodId}
              />
            </div>
          )}

          {remainingAmount > 0 && isTossSelected && (
            <div className="mb-4">
              <TossSubMethodCard value={tossSubMethod} onChange={setTossSubMethod} />
            </div>
          )}

          {remainingAmount > 0 && isBankTransferSelected && (
            <div className="mb-4">
              <CashReceiptCard
                value={cashReceiptState}
                onChange={setCashReceiptState}
                userPhone={userPhone}
                userBizNumber={userBizNumber}
              />
            </div>
          )}

          {availablePoints > 0 && (
            <div className="mb-4">
              <PointsCard
                availablePoints={availablePoints}
                maxPoints={maxPoints}
                usePoints={usePoints}
                pointsAmount={pointsAmount}
                remainingAmount={remainingAmount}
                currency={cart.currency_code ?? 'KRW'}
                onToggle={handleTogglePoints}
                onAmountChange={setPointsAmount}
              />
            </div>
          )}

          <PaymentTotalSection totals={totalsWithPoints} />

          <OrderConsentSection value={consent} onChange={setConsent} hasOverseasItem={hasOverseasItem} />

          <Card className="mb-8 shadow-none">
            <CardHeader className="flex-row items-center gap-2 p-4 pb-3 space-y-0 lg:p-6 lg:pb-4">
              <Info className="size-5 shrink-0 text-primary" />
              <CardTitle className="text-base font-bold lg:text-lg">{tNotice('title')}</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-3 lg:p-6 lg:pt-0">
              <div className="flex items-start gap-2.5">
                <Banknote className="mt-0.5 size-5 shrink-0 text-primary" />
                <p className="text-sm leading-relaxed text-muted-foreground lg:text-[15px]">
                  {tNotice('bankTransfer')}
                </p>
              </div>
              <div className="flex items-start gap-2.5">
                <Clock className="mt-0.5 size-5 shrink-0 text-primary" />
                <p className="text-sm leading-relaxed text-muted-foreground lg:text-[15px]">
                  {tNotice('bankTransferDelay')}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <PCFixedCTA totals={totalsWithPoints} loading={loading} onPayment={handlePayment} disabled={!consentGiven} />
      <MobileCTA loading={loading} onPayment={handlePayment} disabled={!consentGiven} />
    </main>
  );
}

function buildSuccessUrl(origin: string, countryCode: string, intentId: string, orderId?: string): string {
  const base = `${origin}/${countryCode}/checkout/success/${intentId}`;
  return orderId ? `${base}?orderId=${encodeURIComponent(orderId)}` : base;
}
