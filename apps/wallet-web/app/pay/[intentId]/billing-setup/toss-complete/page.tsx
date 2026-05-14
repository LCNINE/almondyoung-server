import { redirect } from 'next/navigation';

interface Props {
  searchParams: Promise<{ returnUrl?: string }>;
}

export default async function TossBillingCompletePage({ searchParams }: Props) {
  const { returnUrl } = await searchParams;
  redirect(returnUrl?.startsWith('/') ? returnUrl : '/');
}
