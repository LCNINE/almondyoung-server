import RouteGuard from '@/components/layout/route-guard';
import { ArchiveTemplate } from '@/features/archive/template';

export default async function ArchivePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <RouteGuard screen="/archive/[id]">
      <ArchiveTemplate pageId={id} />
    </RouteGuard>
  );
}
