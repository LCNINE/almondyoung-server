import { getBillingMethods } from '@/lib/wallet-api';
import { getBackendAuthCookie } from '@/lib/auth/session-cookies';
import { BillingChangeForm } from './billing-change-form';

interface Props {
  searchParams: Promise<{
    returnUrl?: string;
    fail?: string;
    msg?: string;
  }>;
}

export default async function BillingChangePage({ searchParams }: Props) {
  const { returnUrl, fail, msg } = await searchParams;

  const methods = await getBillingMethods(await getBackendAuthCookie());
  const cmsBillingMethod = methods.find((m) => m.providerType === 'CMS_BATCH' && m.status === 'ACTIVE');

  const initialError =
    fail === '1' ? decodeURIComponent(msg ?? '계좌 변경에 실패했습니다. 다시 시도해주세요.') : undefined;

  return (
    <BillingChangeForm
      returnUrl={returnUrl ? decodeURIComponent(returnUrl) : '/'}
      billingMethodId={cmsBillingMethod?.id}
      initialError={initialError}
    />
  );
}
