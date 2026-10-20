import RouteGuard from '@/components/layout/route-guard';

export const dynamic = 'force-dynamic';

export default function CustomerWindowLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <RouteGuard screen="/customer-window/[id]">{children}</RouteGuard>;
}
