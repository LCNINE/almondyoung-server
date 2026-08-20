'use client';

import { Button } from '@/checkout-ui/components/ui/button';
import { PAYMENT_TOTAL_ANCHOR_ID } from '@/checkout-ui/domains/checkout/components/sections/payment-total';
import { CartTotals } from '@/checkout-ui/lib/types/ui/cart';
import { formatPrice } from '@/checkout-ui/lib/utils/price-utils';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

const payButtonClass =
  'w-full rounded bg-[#ff6600] py-3.5 text-[15px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-50';

const SCROLL_NOISE_PX = 4;

const useStickyVisible = () => {
  const [paymentTotalInView, setPaymentTotalInView] = useState(false);
  const [scrollingUp, setScrollingUp] = useState(false);

  useEffect(() => {
    const target = document.getElementById(PAYMENT_TOTAL_ANCHOR_ID);
    if (!target) return;

    const observer = new IntersectionObserver(([entry]) => setPaymentTotalInView(entry.isIntersecting));
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let lastY = window.scrollY;

    const onScroll = () => {
      const y = window.scrollY;
      if (Math.abs(y - lastY) < SCROLL_NOISE_PX) return;
      setScrollingUp(y < lastY);
      lastY = y;
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return scrollingUp || !paymentTotalInView;
};

export const MobileCTA = ({
  onPayment,
  loading,
  totals,
}: {
  onPayment: () => void;
  loading: boolean;
  totals: CartTotals;
}) => {
  const t = useTranslations('checkout.cta');
  const tCart = useTranslations('cart');
  const tTotal = useTranslations('checkout.paymentTotal');
  const tConsent = useTranslations('checkout.consent');
  const stickyVisible = useStickyVisible();

  const originalTotal = totals.original_item_subtotal + totals.shipping;

  return (
    <>
      <footer className="mt-6 px-4 pb-6 lg:hidden">
        <button onClick={onPayment} disabled={loading} className={payButtonClass}>
          {loading ? t('processing') : t('pay')}
        </button>
      </footer>

      <div
        className={`fixed right-0 bottom-0 left-0 z-50 border-t border-gray-200 bg-white px-4 pt-3 pb-4 shadow-[0_-4px_16px_-4px_rgba(0,0,0,0.15)] transition-[transform,opacity] duration-[350ms] ease-[cubic-bezier(0.22,1,0.36,1)] lg:hidden ${
          stickyVisible ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0'
        }`}
      >
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <span className="text-[15px] font-bold text-gray-900">{tTotal('totalAmount')}</span>
          <span className="flex items-baseline gap-1.5">
            {originalTotal > totals.finalTotal && (
              <span className="text-[13px] text-gray-400 line-through">
                {formatPrice(originalTotal)}
                {tCart('won')}
              </span>
            )}
            <span className="text-lg font-bold text-[#ff6600]">
              {formatPrice(totals.finalTotal)}
              {tCart('won')}
            </span>
          </span>
        </div>
        <button onClick={onPayment} disabled={loading} className={payButtonClass}>
          {loading ? t('processing') : t('pay')}
        </button>
        <p className="mt-2 text-center text-[11px] leading-relaxed text-gray-500">{tConsent('agreementNotice')}</p>
      </div>
    </>
  );
};

// PC 하단 고정 CTA
export const PCFixedCTA = ({
  onPayment,
  loading,
  totals,
}: {
  onPayment: () => void;
  loading: boolean;
  totals: CartTotals;
}) => {
  const t = useTranslations('checkout.cta');
  const tCart = useTranslations('cart');
  return (
    <div className="fixed right-0 bottom-0 left-0 z-99 hidden bg-white shadow-[0px_-6px_18px_-2px_rgba(0,0,0,0.25)] lg:block">
      <div className="container mx-auto max-w-[1360px] px-[40px] py-4">
        <div className="flex items-center justify-end">
          <Button
            onClick={onPayment}
            disabled={loading}
            size="lg"
            color="primary"
            className="min-w-[403px] cursor-pointer rounded-[5px] bg-[#ff6600] px-4 py-[14px] text-[19px] font-bold text-white hover:bg-[#ff6600]/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading
              ? t('processing')
              : t('payWithAmount', {
                  amount: `${formatPrice(totals.finalTotal)}${tCart('won')}`,
                })}
          </Button>
        </div>
      </div>
    </div>
  );
};
