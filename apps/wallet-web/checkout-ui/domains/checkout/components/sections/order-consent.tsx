'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/checkout-ui/components/ui/dialog';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';

/**
 * 청약 전 고지 섹션.
 *
 */
export function OrderConsentSection() {
  const t = useTranslations('checkout.consent');
  const params = useParams();

  const countryCode = (params.countryCode as string) ?? (process.env.NEXT_PUBLIC_CHECKOUT_REGION as string) ?? 'kr';
  const docOrigin = process.env.NEXT_PUBLIC_STOREFRONT_ORIGIN ?? '';

  const docs = [
    { key: 'terms', label: t('docs.purchaseTerms'), title: t('docTitles.terms') },
    { key: 'privacy', label: t('docs.personalInfo'), title: t('docTitles.privacy') },
    { key: 'guide', label: t('docs.returns'), title: t('docTitles.guide') },
  ] as const;

  return (
    <section aria-labelledby="order-consent-heading" className="mb-6">
      <h2 id="order-consent-heading" className="sr-only">
        {t('title')}
      </h2>
      <div className="px-1">
        {docs.map((doc) => (
          <Dialog key={doc.key}>
            <DialogTrigger className="flex w-full cursor-pointer items-center justify-between gap-3 py-2 text-left">
              <span className="text-[13px] leading-snug text-gray-700">{doc.label}</span>
              <span className="shrink-0 text-xs text-gray-500 underline underline-offset-2">{t('view')}</span>
            </DialogTrigger>
            <DialogContent className="flex h-[80vh] max-w-[calc(100%-2rem)] flex-col gap-0 p-0 sm:max-w-3xl">
              <DialogHeader className="shrink-0 border-b border-gray-200 px-5 py-4">
                <DialogTitle className="text-base font-bold">{doc.title}</DialogTitle>
              </DialogHeader>
              <iframe
                src={`${docOrigin}/${countryCode}/${doc.key}`}
                title={doc.title}
                className="min-h-0 w-full flex-1 rounded-b-lg"
              />
            </DialogContent>
          </Dialog>
        ))}

        <p className="mt-3 text-center text-[11px] leading-relaxed text-gray-500 lg:text-xs">{t('agreementNotice')}</p>
      </div>
    </section>
  );
}
