'use client';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Plus } from 'lucide-react';
import type { MasterVersionDto, VersionStatus } from '@/lib/types/dto/products';

const STATUS_LABEL: Record<VersionStatus, string> = {
  active: '활성',
  draft: '임시',
  inactive: '비활성',
};

const STATUS_VARIANT: Record<VersionStatus, 'default' | 'secondary' | 'outline'> = {
  active: 'default',
  draft: 'secondary',
  inactive: 'outline',
};

interface Props {
  versions: MasterVersionDto[];
  selectedVersionId: string | null;
  onSelect: (versionId: string) => void;
  onCreateDraft: () => void;
}

export function VersionSelector({ versions, selectedVersionId, onSelect, onCreateDraft }: Props) {
  const flat = flattenVersions(versions);

  return (
    <div className="flex items-center gap-3">
      <span className="text-sm font-medium text-muted-foreground">버전</span>
      <Select value={selectedVersionId ?? ''} onValueChange={onSelect}>
        <SelectTrigger className="w-64">
          <SelectValue placeholder="버전 선택" />
        </SelectTrigger>
        <SelectContent>
          {flat.map((v) => (
            <SelectItem key={v.id} value={v.id}>
              <span className="flex items-center gap-2">
                <span>v{v.version}</span>
                {v.name && <span className="text-muted-foreground">({v.name})</span>}
                <Badge variant={STATUS_VARIANT[v.status]} className="ml-1 text-xs">
                  {STATUS_LABEL[v.status]}
                </Badge>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button size="sm" variant="outline" onClick={onCreateDraft}>
        <Plus className="mr-1 h-3 w-3" />
        새 draft
      </Button>
    </div>
  );
}

function flattenVersions(versions: MasterVersionDto[]): MasterVersionDto[] {
  const result: MasterVersionDto[] = [];
  const walk = (nodes: MasterVersionDto[]) => {
    for (const n of nodes) {
      result.push(n);
      if (n.children?.length) walk(n.children);
    }
  };
  walk(versions);
  return result;
}
