import { isRedirectError } from 'next/dist/client/components/redirect-error';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { issueTossBillingKey, updateBillingAgreementMethod } from '@/lib/wallet-api';

interface Props {
  searchParams: Promise<{
    authKey?: string;
    customerKey?: string;
    returnUrl?: string;
    agreementId?: string;
  }>;
}

export default async function BillingChangeTossCompletePage({ searchParams }: Props) {
  const { authKey, customerKey, returnUrl, agreementId } = await searchParams;

  const failBase = `/billing-change?provider=TOSS&returnUrl=${encodeURIComponent(returnUrl ?? '')}${agreementId ? `&agreementId=${agreementId}` : ''}&fail=1`;

  if (!authKey || !customerKey) {
    redirect(failBase);
  }

  try {
    const cookieStore = await cookies();
    const cookieHeader = cookieStore.toString();

    const { id: billingMethodId } = await issueTossBillingKey(authKey, customerKey, cookieHeader);

    if (agreementId && billingMethodId) {
      await updateBillingAgreementMethod(agreementId, billingMethodId, cookieHeader);
    }

    const successUrl = returnUrl
      ? `${returnUrl}${returnUrl.includes('?') ? '&' : '?'}cardChanged=1`
      : '/';
    redirect(successUrl);
  } catch (e) {
    if (isRedirectError(e)) throw e;
    const msg = encodeURIComponent(e instanceof Error ? e.message : '카드 등록에 실패했습니다.');
    redirect(`${failBase}&msg=${msg}`);
  }
}
