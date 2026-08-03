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
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import type {
  MatchingDto,
  MatchingStrategy,
  MatchingPriority,
  StockPolicyDto,
} from '@/lib/types/dto/matching';
import type { SkuLinkState } from '@/lib/types/ui/matching';
import {
  useUpsertVariantMatching,
  useSetMatchingPriority,
  useChangeMatchingStrategy,
  getMatchingStrategyDecisionLabel,
  getMatchingStrategyDecisionColor,
  createDefaultStockPolicy,
  normalizeStockPolicy,
  buildUpsertMatchingPayload,
  isSameSkuLinks,
} from '@/lib/services/matching';
import { toast } from 'sonner';
import { SkuLookupSection } from '@/features/matching/products/components/variant-editor-dialog/sku-lookup-section';
import { StrategySection } from '@/features/matching/products/components/variant-editor-dialog/strategy-section';
import { StockPolicySection } from '@/features/matching/products/components/variant-editor-dialog/stock-policy-section';
import { VariantAssetSection } from '@/features/matching/products/components/variant-editor-dialog/asset-section';

interface VariantMatchingEditorDialogProps {
  matching: MatchingDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const getCurrentSkuLinks = (
  source?: {
    matchedSkus?: SkuLinkState[];
    links?: SkuLinkState[];
  } | null
) => (source?.matchedSkus?.length ? source.matchedSkus : (source?.links ?? []));

export function VariantMatchingEditorDialog({
  matching,
  open,
  onOpenChange,
}: VariantMatchingEditorDialogProps) {
  const upsert = useUpsertVariantMatching();
  const setPriority = useSetMatchingPriority();
  const setStrategy = useChangeMatchingStrategy();

  const [links, setLinks] = useState<SkuLinkState[]>([]);
  const [strategy, setStrategyState] = useState<MatchingStrategy>('variant');
  const [priority, setPriorityState] = useState<MatchingPriority>('normal');
  const [stockPolicy, setStockPolicy] = useState<StockPolicyDto>(
    createDefaultStockPolicy()
  );

  useEffect(() => {
    if (matching) {
      const currentSkuLinks = getCurrentSkuLinks(matching);
      setLinks(
        currentSkuLinks.map((s) => ({
          skuId: s.skuId,
          skuName: s.skuName,
          skuCode: s.skuCode,
          quantity: s.quantity,
        }))
      );
      setStrategyState(matching.strategy ?? 'variant');
      setPriorityState(matching.priority ?? 'normal');
      setStockPolicy(normalizeStockPolicy(matching.stockPolicy));
    }
  }, [matching]);

  const handleSave = async () => {
    if (!matching) return;

    const currentSkuLinks = getCurrentSkuLinks(matching);
    const changedLinks = !isSameSkuLinks(links, currentSkuLinks);
    const changedPolicy =
      JSON.stringify(stockPolicy) !== JSON.stringify(normalizeStockPolicy(matching.stockPolicy));
    const changedStrategy = strategy !== matching.strategy;
    const changedPriority = priority !== matching.priority;

    const promises: Promise<unknown>[] = [];

    if (changedLinks || changedPolicy) {
      promises.push(
        upsert.mutateAsync({
          variantId: matching.variantId,
          data: buildUpsertMatchingPayload({
            masterId: matching.master?.id ?? '',
            links,
            policy: stockPolicy,
            changedLinks,
          }),
        })
      );
    }
    if (changedStrategy) {
      promises.push(
        setStrategy.mutateAsync({ id: matching.id, data: { strategy } })
      );
    }
    if (changedPriority) {
      promises.push(
        setPriority.mutateAsync({ id: matching.id, data: { priority } })
      );
    }

    if (promises.length === 0) {
      toast.info('변경된 내용이 없습니다.');
      return;
    }

    try {
      await Promise.all(promises);
      toast.success('매칭을 저장했습니다.');
      onOpenChange(false);
    } catch (error) {
      // 실패해도 닫지 않는다 — 닫아버리면 저장된 것처럼 보인다.
      toast.error(
        error instanceof Error ? error.message : '매칭 저장에 실패했습니다.'
      );
    }
  };

  const isLoading =
    upsert.isPending || setPriority.isPending || setStrategy.isPending;

  const title = matching?.variant?.name
    ? `매칭 편집 — ${matching.variant.name}`
    : '매칭 편집';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {matching?.master?.name && (
            <p className="text-sm text-muted-foreground">
              {matching.master.name}
            </p>
          )}
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-1">
          <div className="space-y-4 py-2">
            {matching?.status && (
              <Badge
                className={`text-xs ${getMatchingStrategyDecisionColor({
                  status: matching.status,
                  strategy: matching.strategy,
                  matchedSkus: matching.matchedSkus,
                  links: matching.links,
                })}`}
                variant="outline"
              >
                {getMatchingStrategyDecisionLabel({
                  status: matching.status,
                  strategy: matching.strategy,
                  matchedSkus: matching.matchedSkus,
                  links: matching.links,
                })}
              </Badge>
            )}

            <SkuLookupSection links={links} onChange={setLinks} />

            <Separator />

            {matching?.variantId && (
              <VariantAssetSection variantId={matching.variantId} />
            )}

            <Separator />

            <StrategySection
              strategy={strategy}
              priority={priority}
              onStrategyChange={setStrategyState}
              onPriorityChange={setPriorityState}
            />

            <StockPolicySection value={stockPolicy} onChange={setStockPolicy} />
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button onClick={() => void handleSave()} disabled={isLoading}>
            {isLoading ? '저장 중...' : '저장'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
