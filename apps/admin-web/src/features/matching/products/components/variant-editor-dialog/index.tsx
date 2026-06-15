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
import type { MasterDto, VariantDto } from '@/lib/types/dto/products';
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
  useSetMatchingPriority,
  useChangeMatchingStrategy,
  getMatchingStrategyDecisionLabel,
  getMatchingStrategyDecisionColor,
  createDefaultStockPolicy,
  normalizeStockPolicy,
} from '@/lib/services/matching';
import { matchingQueryKeys } from '@/lib/services/matching';
import { useQueryClient } from '@tanstack/react-query';
import { SkuLookupSection } from './sku-lookup-section';
import { StrategySection } from './strategy-section';
import { StockPolicySection } from './stock-policy-section';
import { VariantAssetSection } from './asset-section';

interface VariantEditorDialogProps {
  master: MasterDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface VariantPanelProps {
  variant: VariantDto;
  masterId: string;
  onSaved: () => void;
}

const getCurrentSkuLinks = (
  source?: {
    matchedSkus?: SkuLinkState[];
    links?: SkuLinkState[];
  } | null
) => (source?.matchedSkus?.length ? source.matchedSkus : (source?.links ?? []));

function VariantPanel({ variant, masterId, onSaved }: VariantPanelProps) {
  const { data: current, isFetched: isMatchingFetched } = useVariantMatching(
    variant.id
  );
  const { data: variantStockPolicy } = useVariantStockPolicy(
    variant.id,
    isMatchingFetched && !current
  );
  const upsert = useUpsertVariantMatching();
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

  const handleSave = async () => {
    const currentSkuLinks = getCurrentSkuLinks(current);
    const currentStockPolicy = current?.stockPolicy ?? variantStockPolicy;
    const changedLinks =
      JSON.stringify(links) !==
      JSON.stringify(
        currentSkuLinks.map((s) => ({
          skuId: s.skuId,
          quantity: s.quantity,
        })) ?? []
      );
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

    if (changedLinks || changedPolicy) {
      promises.push(
        upsert.mutateAsync({
          variantId: variant.id,
          data: { masterId, links, policy: stockPolicy },
        })
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

    if (promises.length > 0) {
      await Promise.all(promises);
      queryClient.invalidateQueries({
        queryKey: matchingQueryKeys.mastersBatchStats([masterId]),
      });
      onSaved();
    }
  };

  const isLoading =
    upsert.isPending || setPriority.isPending || setStrategy.isPending;

  return (
    <div className="space-y-4 py-2">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{variant.name}</span>
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

      <VariantAssetSection variantId={variant.id} />

      <Separator />

      <StrategySection
        strategy={strategy}
        priority={priority}
        onStrategyChange={setStrategyState}
        onPriorityChange={setPriorityState}
      />

      <StockPolicySection value={stockPolicy} onChange={setStockPolicy} />

      <div className="flex justify-end">
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
              <div className="space-y-1 pr-1">
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
                <VariantPanel
                  key={selectedVariant.id}
                  variant={selectedVariant}
                  masterId={master.id}
                  onSaved={() => {}}
                />
              </ScrollArea>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
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
