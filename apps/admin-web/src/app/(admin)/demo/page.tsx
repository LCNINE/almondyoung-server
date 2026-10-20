import { notFound } from 'next/navigation';
import RouteGuard from '@/components/layout/route-guard';
import { isDemoConsoleEnabled } from '@/lib/demo/capabilities';
import { DemoConsole } from '@/features/demo/demo-console';

export default function DemoPage() {
  if (!isDemoConsoleEnabled(process.env)) notFound();
  return (
    <RouteGuard screen="/demo">
      <DemoConsole />
    </RouteGuard>
  );
}
