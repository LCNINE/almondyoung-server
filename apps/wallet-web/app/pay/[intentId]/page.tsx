import { notFound } from 'next/navigation';
import { getPaymentIntent, getPaymentMethods } from '@/lib/wallet-api';
import { PayForm } from './pay-form';

interface Props {
  params: Promise<{ intentId: string }>;
  searchParams: Promise<{ client_secret?: string }>;
}

export default async function PayPage({ params, searchParams }: Props) {
  const { intentId } = await params;
  const { client_secret: clientSecret } = await searchParams;

  if (!clientSecret) {
    notFound();
  }

  let intent;
  try {
    intent = await getPaymentIntent(intentId, clientSecret);
  } catch {
    notFound();
  }

  const methods = await getPaymentMethods(intent.externalUserId, clientSecret).catch(() => []);

  if (intent.status === 'SUCCEEDED') {
    const returnUrl = intent.returnUrl
      ? `${intent.returnUrl}?payment_intent_id=${intent.id}&status=succeeded`
      : null;
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <div className="mx-auto max-w-md w-full px-4 text-center space-y-4">
          <div className="text-4xl">✅</div>
          <h1 className="text-xl font-semibold">결제가 완료되었어요</h1>
          {returnUrl && (
            <a href={returnUrl} className="text-sm text-muted-foreground underline">
              돌아가기
            </a>
          )}
        </div>
      </main>
    );
  }

  if (intent.status === 'CANCELED') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <div className="mx-auto max-w-md w-full px-4 text-center space-y-4">
          <div className="text-4xl">❌</div>
          <h1 className="text-xl font-semibold">결제가 취소되었어요</h1>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background">
      <div className="mx-auto max-w-md w-full px-4 py-8">
        <PayForm intent={intent} methods={methods} clientSecret={clientSecret} />
      </div>
    </main>
  );
}
