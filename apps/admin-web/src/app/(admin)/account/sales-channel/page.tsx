/** @format */

// src/app/(admin)/account/sales-channel/page.tsx
import RouteGuard from '@/components/layout/route-guard';
import SalesChannelPageClient from './SalesChannelPageClient';

export default function SalesChannelPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <SalesChannelPageClient />
    </RouteGuard>
  );
}
