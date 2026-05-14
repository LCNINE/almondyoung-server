import { redirect } from 'next/navigation';

interface Props {
  searchParams: Promise<{ returnUrl?: string }>;
}

export default async function BillingChangeTossCompletePage({ searchParams }: Props) {
  const { returnUrl } = await searchParams;
  redirect(returnUrl?.startsWith('/') ? returnUrl : '/');
}
