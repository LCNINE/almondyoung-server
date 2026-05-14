import { BillingSetupForm } from './billing-setup-form';

interface Props {
  searchParams: Promise<{ returnUrl?: string; fail?: string; msg?: string; mode?: string }>;
}

export default async function BillingSetupPage({ searchParams }: Props) {
  const { returnUrl, fail, msg, mode } = await searchParams;

  const initialError =
    fail === '1' ? decodeURIComponent(msg ?? '카드 등록에 실패했습니다. 다시 시도해주세요.') : undefined;

  return (
    <BillingSetupForm
      returnUrl={returnUrl ? decodeURIComponent(returnUrl) : '/'}
      initialError={initialError}
      mode={mode === 'initial' ? 'initial' : undefined}
    />
  );
}
