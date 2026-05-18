'use client';

import { useRouter } from 'next/navigation';
import { Container } from '@/components/admin-ui-experimental/common/container';
import { Header } from '@/components/admin-ui-experimental/common/header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import type { MasterVersionDto } from '@/lib/types/dto/products';

type Props = {
  masterId: string;
  versions: MasterVersionDto[];
  onClose: () => void;
};

function formatDate(iso: string): string {
  return iso.slice(0, 10);
}

export function CollapsedChainPanel({ masterId, versions, onClose }: Props) {
  const router = useRouter();

  const sorted = [...versions].sort((a, b) => a.version - b.version);

  return (
    <Container>
      <Header
        title={`접힌 ${versions.length}개 버전`}
        right={
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="닫기">
            <X className="h-4 w-4" />
          </Button>
        }
      />
      <ul className="divide-y">
        {sorted.map((v) => (
          <li
            key={v.id}
            className="flex cursor-pointer items-center justify-between px-3 py-2 text-sm hover:bg-gray-50"
            onClick={() =>
              router.push(`/mall/products-list/${masterId}?versionId=${v.id}`)
            }
          >
            <div className="flex items-center gap-2">
              <span className="font-medium">v{v.version}</span>
              {v.status === 'active' && (
                <Badge variant="default" className="text-[10px]">
                  active
                </Badge>
              )}
            </div>
            <span className="text-xs text-gray-500">{formatDate(v.createdAt)}</span>
          </li>
        ))}
      </ul>
    </Container>
  );
}
