'use client';

import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  useRegions,
  useRegionPaymentMethods,
  useUpdateRegion,
  usePutRegionPaymentMethods,
} from '@/lib/services/wallet';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { CreateRegionDialog } from './components/create-region-dialog';

export default function RegionsTemplate() {
  const { data: regionsData, isLoading: regionsLoading } = useRegions();
  const regions = useMemo(() => regionsData ?? [], [regionsData]);

  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  // 리전 활성화 로컬 편집: region code -> 변경된 isActive
  const [regionActiveEdits, setRegionActiveEdits] = useState<
    Record<string, boolean>
  >({});
  // 매트릭스 로컬 편집: code -> 변경된 isEnabled
  const [methodEdits, setMethodEdits] = useState<Record<string, boolean>>({});

  const updateRegion = useUpdateRegion();
  const putMethods = usePutRegionPaymentMethods();
  const { data: matrix, isLoading: matrixLoading } =
    useRegionPaymentMethods(selectedCode);

  // 첫 리전 자동 선택
  useEffect(() => {
    if (!selectedCode && regions.length > 0) setSelectedCode(regions[0].code);
  }, [regions, selectedCode]);

  // 리전 전환 시 해당 리전의 결제수단 편집만 초기화
  useEffect(() => {
    setMethodEdits({});
  }, [selectedCode]);

  const effectiveRegionActive = (code: string, isActive: boolean) =>
    regionActiveEdits[code] ?? isActive;
  const effectiveMethodEnabled = (code: string, regionEnabled: boolean) =>
    methodEdits[code] ?? regionEnabled;
  const hasRegionChanges = Object.keys(regionActiveEdits).length > 0;
  const hasMethodChanges = Object.keys(methodEdits).length > 0;
  const hasChanges = hasRegionChanges || hasMethodChanges;

  const handleRegionActiveToggle = (
    code: string,
    original: boolean,
    next: boolean
  ) => {
    setRegionActiveEdits((prev) => {
      const draft = { ...prev };
      if (next === original) delete draft[code];
      else draft[code] = next;
      return draft;
    });
  };

  const handleMethodToggle = (
    code: string,
    regionEnabled: boolean,
    next: boolean
  ) => {
    setMethodEdits((prev) => {
      const draft = { ...prev };
      // 원래 값과 같아지면 편집 목록에서 제거
      if (next === regionEnabled) delete draft[code];
      else draft[code] = next;
      return draft;
    });
  };

  const handleSave = async () => {
    if (!selectedCode || (hasMethodChanges && !matrix)) return;

    setIsSaving(true);
    try {
      for (const [code, isActive] of Object.entries(regionActiveEdits)) {
        await updateRegion.mutateAsync({
          code,
          payload: { isActive },
        });
      }

      if (hasMethodChanges && matrix) {
        const items = matrix.items
          .filter((it) => it.supportStatus === 'supported')
          .map((it) => ({
            code: it.code,
            isEnabled: effectiveMethodEnabled(it.code, it.regionEnabled),
            sortOrder: it.sortOrder,
          }));
        await putMethods.mutateAsync({ code: selectedCode, items });
      }

      toast.success('변경사항을 저장했어요.');
      setRegionActiveEdits({});
      setMethodEdits({});
    } catch {
      toast.error('저장에 실패했어요.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Container className="divide-y-0">
      <Header
        title="리전·결제수단 관리"
        subtitle="리전(국가)별로 노출할 결제수단을 설정합니다. 실제 노출은 결제수단의 글로벌 활성화와 리전 활성화가 모두 켜진 경우입니다."
        right={<Button onClick={() => setCreateOpen(true)}>리전 추가</Button>}
      />

      <div className="flex gap-4 px-6 pb-6">
        {/* 리전 목록 */}
        <div className="border rounded-md w-72 shrink-0">
          <div className="px-3 py-2 text-sm font-semibold border-b">리전</div>
          {regionsLoading && (
            <div className="px-3 py-4 text-sm text-muted-foreground">
              불러오는 중...
            </div>
          )}
          {!regionsLoading && regions.length === 0 && (
            <div className="px-3 py-4 text-sm text-muted-foreground">
              등록된 리전이 없습니다.
            </div>
          )}
          {regions.map((r) => {
            const isActive = effectiveRegionActive(r.code, r.isActive);
            return (
              <div
                key={r.id}
                className={`flex items-center justify-between gap-2 border-b px-3 py-2 ${
                  selectedCode === r.code ? 'bg-muted' : ''
                }`}
              >
                <button
                  type="button"
                  className="flex items-center flex-1 gap-2 text-left"
                  onClick={() => setSelectedCode(r.code)}
                >
                  <span className="font-mono text-sm uppercase">{r.code}</span>
                  <span className="text-sm">{r.name}</span>
                  {!isActive && <Badge variant="secondary">비활성</Badge>}
                </button>
                <Switch
                  checked={isActive}
                  onCheckedChange={(v) =>
                    handleRegionActiveToggle(r.code, r.isActive, v)
                  }
                  disabled={isSaving}
                  aria-label={`리전 ${r.code} 활성화`}
                />
              </div>
            );
          })}
        </div>

        {/* 선택 리전의 결제수단 매트릭스 */}
        <div className="flex-1">
          {!selectedCode && (
            <div className="py-8 text-sm text-center text-muted-foreground">
              리전을 선택하세요.
            </div>
          )}
          {selectedCode && (
            <>
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm text-muted-foreground">
                  {matrix
                    ? `${matrix.region.name} (${matrix.region.code}) 결제수단`
                    : '불러오는 중...'}
                </div>
                <Button
                  onClick={handleSave}
                  disabled={
                    !hasChanges || isSaving || (hasMethodChanges && !matrix)
                  }
                  size="sm"
                  className={[
                    'bg-slate-900 text-white hover:bg-slate-800',
                    'disabled:bg-slate-200 disabled:text-slate-500 disabled:opacity-100',
                  ].join(' ')}
                >
                  {isSaving ? '저장 중...' : '변경사항 저장'}
                </Button>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>결제수단</TableHead>
                    <TableHead>글로벌</TableHead>
                    <TableHead>실제 노출</TableHead>
                    <TableHead className="w-[120px] text-right">
                      리전 활성화
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {matrixLoading && (
                    <TableRow>
                      <TableCell
                        colSpan={4}
                        className="py-8 text-center text-muted-foreground"
                      >
                        불러오는 중...
                      </TableCell>
                    </TableRow>
                  )}
                  {matrix?.items.map((it) => {
                    const regionEnabled = effectiveMethodEnabled(
                      it.code,
                      it.regionEnabled
                    );
                    const regionActive = effectiveRegionActive(
                      matrix.region.code,
                      matrix.region.isActive
                    );
                    const available =
                      regionActive && it.globalEnabled && regionEnabled;
                    return (
                      <TableRow key={it.code}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm">{it.code}</span>
                            <span className="text-sm text-muted-foreground">
                              {it.displayName}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              it.supportStatus === 'retired'
                                ? 'outline'
                                : it.globalEnabled
                                  ? 'default'
                                  : 'secondary'
                            }
                          >
                            {it.supportStatus === 'retired'
                              ? '지원 중단'
                              : it.globalEnabled
                                ? '활성'
                                : '비활성'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={available ? 'default' : 'outline'}>
                            {available ? '노출' : '숨김'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Switch
                            checked={regionEnabled}
                            onCheckedChange={(v) =>
                              handleMethodToggle(it.code, it.regionEnabled, v)
                            }
                            disabled={isSaving || it.isRetired}
                            aria-label={`${it.displayName} ${matrix.region.code} 활성화`}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {matrix?.items.some((it) => !it.globalEnabled) && (
                <p className="mt-2 text-xs text-muted-foreground">
                  * 글로벌이 비활성인 결제수단은 리전에서 켜도 실제로는
                  숨겨집니다. ‘결제수단 관리’에서 글로벌을 먼저 켜세요.
                </p>
              )}
            </>
          )}
        </div>
      </div>

      <CreateRegionDialog open={createOpen} onOpenChange={setCreateOpen} />
    </Container>
  );
}
