import { notFound } from 'next/navigation';
import { PaymentDesignPreview } from './preview';

export const dynamic = 'force-dynamic';

export default function PaymentDesignPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <PaymentDesignPreview />;
}
