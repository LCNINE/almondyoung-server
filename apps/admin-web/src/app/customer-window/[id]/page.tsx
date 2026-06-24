import CustomerDetailWindowTemplate from '@/features/customers/detail-window/template';

export default async function CustomerWindowPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CustomerDetailWindowTemplate customerId={id} />;
}
