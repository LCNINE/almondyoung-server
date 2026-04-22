import { isRedirectError } from 'next/dist/client/components/redirect-error';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { issueTossBillingKey } from '@/lib/wallet-api';

interface Props {
  params: Promise<{ intentId: string }>;
  searchParams: Promise<{ authKey?: string; customerKey?: string; returnUrl?: string }>;
}

export default async function TossBillingCompletePage({ params, searchParams }: Props) {
  const { intentId } = await params;
  const { authKey, customerKey, returnUrl } = await searchParams;

  const failBase = `/pay/${intentId}/billing-setup?provider=TOSS&returnUrl=${encodeURIComponent(returnUrl ?? '')}&fail=1`;

  if (!authKey || !customerKey) {
    redirect(failBase);
  }

  try {
    const cookieStore = await cookies();
    await issueTossBillingKey(authKey, customerKey, cookieStore.toString());

    redirect(returnUrl ?? '/');
  } catch (e) {
    if (isRedirectError(e)) throw e;
    const msg = encodeURIComponent(e instanceof Error ? e.message : '카드 등록에 실패했습니다.');
    redirect(`${failBase}&msg=${msg}`);
  }
}
