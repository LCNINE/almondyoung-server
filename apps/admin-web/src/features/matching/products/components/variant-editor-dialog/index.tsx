'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import type { MasterDto } from '@/lib/types/dto/products';
import type {
  MatchingStrategy,
  MatchingPriority,
  StockPolicyDto,
} from '@/lib/types/dto/matching';
import type { SkuLinkState } from '@/lib/types/ui/matching';
import {
  useVariantMatching,
  useVariantStockPolicy,
  useUpsertVariantMatching,
  useUpdateVariantStockPolicy,
  useSetMatchingPriority,
  useChangeMatchingStrategy,
  getMatchingStrategyDecisionLabel,
  getMatchingStrategyDecisionColor,
  createDefaultStockPolicy,
  normalizeStockPolicy,
  buildUpsertMatchingPayload,
  isSameSkuLinks,
} from '@/lib/services/matching';
import { matchingQueryKeys } from '@/lib/services/matching';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { SkuLookupSection } from './sku-lookup-section';
import { StrategySection } from './strategy-section';
import { StockPolicySection } from './stock-policy-section';
import { VariantAssetSection } from './asset-section';

interface VariantEditorDialogProps {
  master: MasterDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface VariantMatchingPanelProps {
  variantId: string;
  variantName: string | null;
  masterId: string;
  onSaved?: () => void;
}

const getCurrentSkuLinks = (
  source?: {
    matchedSkus?: SkuLinkState[];
    links?: SkuLinkState[];
  } | null
) => (source?.matchedSkus?.length ? source.matchedSkus : (source?.links ?? []));

export function VariantMatchingPanel({
  variantId,
  variantName,
  masterId,
  onSaved,
}: VariantMatchingPanelProps) {
  const { data: current, isFetched: isMatchingFetched } =
    useVariantMatching(variantId);
  const { data: variantStockPolicy } = useVariantStockPolicy(
    variantId,
    isMatchingFetched && !current
  );
  const upsert = useUpsertVariantMatching();
  const updateStockPolicy = useUpdateVariantStockPolicy();
  const setPriority = useSetMatchingPriority();
  const setStrategy = useChangeMatchingStrategy();
  const queryClient = useQueryClient();

  const [links, setLinks] = useState<SkuLinkState[]>([]);
  const [strategy, setStrategyState] = useState<MatchingStrategy>('variant');
  const [priority, setPriorityState] = useState<MatchingPriority>('normal');
  const [stockPolicy, setStockPolicy] = useState<StockPolicyDto>(
    createDefaultStockPolicy()
  );

  useEffect(() => {
    if (current) {
      const currentSkuLinks = getCurrentSkuLinks(current);
      setLinks(
        currentSkuLinks.map((s) => ({
          skuId: s.skuId,
          skuName: s.skuName,
          skuCode: s.skuCode,
          quantity: s.quantity,
        })) ?? []
      );
      setStrategyState(current.strategy ?? 'variant');
      setPriorityState(current.priority ?? 'normal');
      setStockPolicy(normalizeStockPolicy(current.stockPolicy));
    } else if (isMatchingFetched) {
      setLinks([]);
      setStrategyState('variant');
      setPriorityState('normal');
      setStockPolicy(normalizeStockPolicy(variantStockPolicy));
    }
  }, [current, isMatchingFetched, variantStockPolicy]);

  // 저장 버튼이 있는 폼이므로 재고 정책도 저장 버튼에 태운다. 예전엔 체크 즉시 저장했는데,
  // 그 invalidate 가 current 를 refetch 시키고 아래 useEffect 가 편집 중인 state 를 서버값으로
  // 되덮어써서 (1) 입력한 출시일이 화면에서 사라지고 (2) 저장 버튼은 차이를 못 찾아
  // "변경된 내용이 없습니다" 를 띄웠다.
  const handleStockPolicyChange = (policy: StockPolicyDto) => {
    setStockPolicy(normalizeStockPolicy(policy));
  };

  const handleSave = async () => {
    const currentSkuLinks = getCurrentSkuLinks(current);
    const currentStockPolicy = current?.stockPolicy ?? variantStockPolicy;
    const changedLinks = !isSameSkuLinks(links, currentSkuLinks);
    const changedPolicy =
      JSON.stringify(stockPolicy) !==
      JSON.stringify(normalizeStockPolicy(currentStockPolicy));
    const changedStrategy =
      strategy !==
      (current as { strategy?: MatchingStrategy } | undefined)?.strategy;
    const changedPriority =
      priority !==
      (current as { priority?: MatchingPriority } | undefined)?.priority;

    const promises: Promise<unknown>[] = [];

    if (changedLinks) {
      promises.push(
        upsert.mutateAsync({
          variantId,
          data: buildUpsertMatchingPayload({
            masterId,
            links,
            policy: stockPolicy,
            changedLinks,
          }),
        })
      );
    } else if (changedPolicy) {
      // 링크가 그대로면 upsert 를 태우지 않는다 — 매칭이 없는 variant 에서 upsert 는
      // 정책만 바꾸려다 매칭까지 만들어버린다. stock-policy 경로는 정책만 건드린다.
      promises.push(
        updateStockPolicy.mutateAsync({ variantId, data: stockPolicy })
      );
    }
    if (changedStrategy && current && 'id' in current) {
      promises.push(
        setStrategy.mutateAsync({
          id: (current as { id: string }).id,
          data: { strategy },
        })
      );
    }
    if (changedPriority && current && 'id' in current) {
      promises.push(
        setPriority.mutateAsync({
          id: (current as { id: string }).id,
          data: { priority },
        })
      );
    }

    if (promises.length === 0) {
      toast.info('변경된 내용이 없습니다.');
      return;
    }

    try {
      await Promise.all(promises);
      queryClient.invalidateQueries({
        queryKey: matchingQueryKeys.mastersBatchStats([masterId]),
      });
      toast.success('매칭을 저장했습니다.');
      onSaved?.();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : '매칭 저장에 실패했습니다.'
      );
    }
  };

  const isLoading =
    upsert.isPending ||
    updateStockPolicy.isPending ||
    setPriority.isPending ||
    setStrategy.isPending;

  return (
    <div className="py-2 space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{variantName ?? variantId}</span>
        {current?.status && (
          <Badge
            className={`text-xs ${getMatchingStrategyDecisionColor({
              status: current.status,
              strategy: current.strategy,
              matchedSkus: current.matchedSkus,
              links: current.links,
            })}`}
            variant="outline"
          >
            {getMatchingStrategyDecisionLabel({
              status: current.status,
              strategy: current.strategy,
              matchedSkus: current.matchedSkus,
              links: current.links,
            })}
          </Badge>
        )}
      </div>

      <SkuLookupSection links={links} onChange={setLinks} />

      <Separator />

      <VariantAssetSection variantId={variantId} />

      <Separator />

      <StrategySection
        strategy={strategy}
        priority={priority}
        onStrategyChange={setStrategyState}
        onPriorityChange={setPriorityState}
      />

      <StockPolicySection
        value={stockPolicy}
        strategy={strategy}
        onChange={handleStockPolicyChange}
      />

      <div className="sticky bottom-0 -mx-4 -mb-4 flex justify-end border-t bg-background px-4 py-3">
        <Button size="sm" onClick={handleSave} disabled={isLoading}>
          {isLoading ? '저장 중...' : '저장'}
        </Button>
      </div>
    </div>
  );
}

export function VariantEditorDialog({
  master,
  open,
  onOpenChange,
}: VariantEditorDialogProps) {
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(
    null
  );

  useEffect(() => {
    if (open && master?.variants?.length) {
      setSelectedVariantId(master.variants[0].id);
    }
  }, [open, master]);

  const variants = master?.variants ?? [];
  const selectedVariant = variants.find((v) => v.id === selectedVariantId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>매칭 편집 — {master?.name}</DialogTitle>
        </DialogHeader>

        <div className="flex gap-4" style={{ minHeight: 400 }}>
          <div className="w-40 shrink-0">
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              Variant 목록
            </p>
            <ScrollArea className="h-[360px]">
              <div className="pr-1 space-y-1">
                {variants.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => setSelectedVariantId(v.id)}
                    className={`w-full rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                      v.id === selectedVariantId
                        ? 'bg-primary text-primary-foreground'
                        : 'hover:bg-muted'
                    }`}
                  >
                    {v.name}
                  </button>
                ))}
              </div>
            </ScrollArea>
          </div>

          <Separator orientation="vertical" className="h-auto" />

          <div className="flex-1">
            {selectedVariant && master ? (
              <ScrollArea className="h-[360px] pr-2">
                <VariantMatchingPanel
                  key={selectedVariant.id}
                  variantId={selectedVariant.id}
                  variantName={selectedVariant.name}
                  masterId={master.id}
                  onSaved={() => {}}
                />
              </ScrollArea>
            ) : (
              <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                왼쪽에서 variant를 선택하세요.
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            닫기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
