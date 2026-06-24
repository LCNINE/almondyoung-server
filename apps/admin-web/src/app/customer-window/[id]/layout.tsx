import RouteGuard from '@/components/layout/route-guard';

export const dynamic = 'force-dynamic';

export default function CustomerWindowLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <RouteGuard requireRole={['admin', 'master']}>{children}</RouteGuard>;
}
