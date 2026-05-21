'use client';

import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDigitalAssets, useVariantAssets, useSetVariantAssetLinks } from '@/lib/services/library';
import type { DigitalAssetDto } from '@/lib/types/dto/library';
import { toast } from 'sonner';

interface VariantAssetSectionProps {
  variantId: string;
}

/**
 * Variant ↔ digital asset 매칭 섹션.
 * SKU 매칭과 평행한 fulfillment track (CONTEXT.md "라이브러리"). 매칭 정션은 master version
 * CoW + publish 인계의 대상 — docs/adr/0004.
 */
export function VariantAssetSection({ variantId }: VariantAssetSectionProps) {
  const { data: linked, isLoading: linkedLoading } = useVariantAssets(variantId);
  const { data: catalog, isLoading: catalogLoading } = useDigitalAssets({ limit: 100 });
  const setLinks = useSetVariantAssetLinks();

  // 로컬 상태로 편집 — 저장 시점에 PUT 으로 replace
  const [editing, setEditing] = useState<string[] | null>(null);
  const [search, setSearch] = useState('');

  const linkedIds = useMemo(() => editing ?? (linked ?? []).map((a) => a.id), [editing, linked]);

  const filteredCatalog = useMemo(() => {
    const all = catalog?.data ?? [];
    const q = search.trim().toLowerCase();
    return q ? all.filter((a) => a.name.toLowerCase().includes(q)) : all;
  }, [catalog, search]);

  const linkedAssetsMap = useMemo(() => {
    const m = new Map<string, DigitalAssetDto>();
    for (const a of linked ?? []) m.set(a.id, a);
    for (const a of catalog?.data ?? []) m.set(a.id, a);
    return m;
  }, [linked, catalog]);

  const toggle = (id: string) => {
    setEditing((prev) => {
      const base = prev ?? (linked ?? []).map((a) => a.id);
      return base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
    });
  };

  const handleSave = async () => {
    if (editing === null) return;
    try {
      await setLinks.mutateAsync({ variantId, dto: { assetIds: editing } });
      setEditing(null);
      toast.success('자산 매칭이 업데이트되었습니다.');
    } catch {
      toast.error('업데이트에 실패했습니다.');
    }
  };

  const handleCancel = () => setEditing(null);

  const isDirty = editing !== null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">디지털 자산 매칭</p>
        {isDirty && (
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={handleCancel}>
              취소
            </Button>
            <Button size="sm" onClick={handleSave} disabled={setLinks.isPending}>
              저장
            </Button>
          </div>
        )}
      </div>

      {linkedLoading ? (
        <p className="text-xs text-muted-foreground">불러오는 중…</p>
      ) : (
        <>
          {linkedIds.length > 0 ? (
            <div className="space-y-1.5">
              {linkedIds.map((id) => {
                const a = linkedAssetsMap.get(id);
                return (
                  <div
                    key={id}
                    className="flex items-center gap-2 rounded-md border px-3 py-1.5"
                  >
                    <span className="flex-1 text-xs">
                      {a ? a.name : id}
                      {a?.currentFileVersion && (
                        <span className="ml-2 text-muted-foreground">v{a.currentFileVersion.version}</span>
                      )}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-destructive hover:text-destructive"
                      onClick={() => toggle(id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">매칭된 자산이 없습니다.</p>
          )}

          <div className="rounded-md border bg-muted/20 p-2">
            <Input
              placeholder="자산 검색"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-7 text-xs"
            />
            <div className="mt-2 max-h-40 space-y-1 overflow-y-auto pr-1">
              {catalogLoading ? (
                <p className="text-xs text-muted-foreground">자산 목록 불러오는 중…</p>
              ) : filteredCatalog.length === 0 ? (
                <p className="text-xs text-muted-foreground">검색 결과가 없습니다.</p>
              ) : (
                filteredCatalog.map((a) => {
                  const already = linkedIds.includes(a.id);
                  return (
                    <button
                      key={a.id}
                      type="button"
                      className="flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-xs hover:bg-background disabled:opacity-50"
                      disabled={already}
                      onClick={() => toggle(a.id)}
                    >
                      <Plus className="h-3 w-3" />
                      <span className="flex-1 truncate">{a.name}</span>
                      {a.mimeType && (
                        <span className="text-muted-foreground">{a.mimeType}</span>
                      )}
                      {already && <span className="text-muted-foreground">·추가됨</span>}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
