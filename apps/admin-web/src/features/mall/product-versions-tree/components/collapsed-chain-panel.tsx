'use client';

import { useRouter } from 'next/navigation';
import { Container } from '@/components/admin-ui-experimental/common/container';
import { Header } from '@/components/admin-ui-experimental/common/header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import type { MasterVersionDto, VersionStatus } from '@/lib/types/dto/products';

type Props = {
  masterId: string;
  versions: MasterVersionDto[];
  onClose: () => void;
};

function formatDate(iso: string): string {
  return iso.slice(0, 10);
}

const STATUS_META = {
  active: { label: 'active', badgeVariant: 'default' },
  draft: { label: 'draft', badgeVariant: 'secondary' },
  inactive: { label: 'inactive', badgeVariant: 'outline' },
} satisfies Record<
  VersionStatus,
  { label: string; badgeVariant: 'default' | 'secondary' | 'outline' }
>;

export function CollapsedChainPanel({ masterId, versions, onClose }: Props) {
  const router = useRouter();

  const sorted = [...versions].sort((a, b) => a.version - b.version);

  return (
    <Container>
      <Header
        title={`접힌 ${versions.length}개 버전`}
        right={
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="닫기">
            <X />
          </Button>
        }
      />
      <ul className="divide-y">
        {sorted.map((v) => (
          <CollapsedVersionRow
            key={v.id}
            version={v}
            onClick={() => router.push(`/mall/products-list/${masterId}?versionId=${v.id}`)}
          />
        ))}
      </ul>
    </Container>
  );
}

function CollapsedVersionRow({
  version,
  onClick,
}: {
  version: MasterVersionDto;
  onClick: () => void;
}) {
  const meta = STATUS_META[version.status];

  return (
    <li
      className="flex cursor-pointer items-center justify-between px-3 py-2 text-sm hover:bg-gray-50"
      onClick={onClick}
    >
      <div className="flex items-center gap-2">
        <span className="font-medium">v{version.version}</span>
        <Badge variant={meta.badgeVariant} className="text-[10px]">
          {meta.label}
        </Badge>
      </div>
      <span className="text-xs text-gray-500">{formatDate(version.createdAt)}</span>
    </li>
  );
}
