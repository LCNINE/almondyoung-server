'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { isAxiosError } from 'axios';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { almondTemplatesClient } from '@/lib/api/domains/products/almond-templates.client';
import {
  useLinkAlmondTemplateProduct,
  usePreviewAlmondTemplateImage,
  usePrintOptions,
  usePrintQuotes,
  usePublishPrintProduct,
} from '@/lib/services/products';
import type { AdminAlmondTemplateDto } from '@/lib/types/dto/products';
import type { PrintComboDto, PrintKind, PublishPrintComboDto } from '@/lib/types/dto/print-catalog';
import { cn } from '@/lib/utils/ui';
import { almondTemplateKindLabel } from '../lib/almond-template-rules';
import {
  COMBO_LIMIT,
  gridSize,
  quoteId,
  applyTimes,
  blockers,
  clearDraft,
  combos,
  defaultAwk,
  loadDraft,
  memberPriceFor,
  parseTemplateSize,
  qtyAllowed,
  qtyChoices,
  qtyLabel,
  saveDraft,
  type ComboLabels,
  type DiscountPct,
  type PickedAxes,
  type PublishDraft,
} from './publish-model';
import { StepConfirm } from './step-confirm';
import { StepOptions, type AxisName, type OptionRow } from './step-options';
import { StepProduct } from './step-product';

interface PublishDialogProps {
  template: AdminAlmondTemplateDto;
  kind: PrintKind;
  onClose: () => void;
}

const STEPS = ['① 상품', '② 옵션·가격', '③ 확인'] as const;
const EMPTY_PICK: PickedAxes = { papers: [], colors: [], qtys: [] };

function serverMessage(error: unknown): string | null {
  if (!isAxiosError(error)) return null;

  const data: unknown = error.response?.data;
  const raw = typeof data === 'object' && data !== null && 'message' in data ? data.message : undefined;
  const message = Array.isArray(raw) ? raw.join(', ') : raw;

  return typeof message === 'string' ? message : null;
}

function initialDraft(template: AdminAlmondTemplateDto): PublishDraft {
  return (
    loadDraft(template.id) ?? {
      step: 1,
      name: template.title,
      description: [template.industry, template.purpose].filter(Boolean).join(' · '),
      picked: EMPTY_PICK,
      times: 2.5,
      discountPct: 0,
      edited: {},
      off: [],
    }
  );
}

export function PublishDialog({ template, kind, onClose }: PublishDialogProps) {
  const [draft, setDraft] = useState<PublishDraft>(() => initialDraft(template));
  const [costs, setCosts] = useState<Record<string, number | null>>({});
  const [retryTick, setRetryTick] = useState(0);
  const [publishing, setPublishing] = useState(false);
  const [masterId, setMasterId] = useState<string | null>(null);
  const requested = useRef(new Set<string>());

  const { width, height } = parseTemplateSize(template.size);
  const optionsQuery = usePrintOptions(kind, width, height);
  const options = optionsQuery.data;
  const quotes = usePrintQuotes();
  const preview = usePreviewAlmondTemplateImage();
  const publish = usePublishPrintProduct();
  const link = useLinkAlmondTemplateProduct();

  const thumbnailUrl = almondTemplatesClient.thumbnailUrl(template.id, template.updatedAt);
  const { step, picked, times, discountPct } = draft;
  const update = (patch: Partial<PublishDraft>) => setDraft((prev) => ({ ...prev, ...patch }));

  useEffect(() => saveDraft(template.id, draft), [template.id, draft]);

  // 처음 옵션을 받으면 첫 용지·모든 면·첫 수량을 골라 둔다
  useEffect(() => {
    if (!options) return;

    const firstQty = qtyChoices(options.quantities)[0];
    setDraft((prev) =>
      prev.picked.papers.length > 0
        ? prev
        : {
            ...prev,
            picked: {
              papers: options.papers.slice(0, 1).map((p) => p.paperno),
              colors: options.colors.map((c) => c.colorno),
              qtys: firstQty === undefined ? [] : [firstQty],
            },
          }
    );
  }, [options]);

  const awk = useMemo(() => (options ? defaultAwk(options.requiredAwk, options.forbiddenAwk) : []), [options]);

  // 임시 저장한 선택 중 지금 와우프레스에 없는 값은 버린다
  const list = useMemo(() => {
    if (!options) return [];

    const papers = new Set(options.papers.map((p) => p.paperno));
    const colors = new Set(options.colors.map((c) => c.colorno));
    const current = {
      papers: picked.papers.filter((v) => papers.has(v)),
      colors: picked.colors.filter((v) => colors.has(v)),
      qtys: picked.qtys,
    };

    return combos(current, awk, (p, c, q) => qtyAllowed(options.quantities, p, c, q));
  }, [options, picked, awk]);
  const listSignature = list.map((c) => c.key).join(',');

  // 옵션 단계부터 아직 부르지 않은 조합만 견적한다
  useEffect(() => {
    if (step < 2 || list.length === 0) return;

    const size = { width, height };
    const missing = list.filter((c) => !requested.current.has(quoteId(c, size)));
    if (missing.length === 0) return;

    // 응답은 보낸 입력의 견적 id 로 저장해, 그 사이 후가공이 바뀌면 지금 행이 옛 견적을 읽지 않게 한다
    const sentIds = new Map(missing.map((c) => [c.key, quoteId(c, size)]));
    for (const id of sentIds.values()) requested.current.add(id);
    quotes
      .mutateAsync({ kind, body: { width, height, combos: missing } })
      .then((result) =>
        setCosts((prev) => {
          const next = { ...prev };
          for (const r of result) {
            const id = sentIds.get(r.key);
            if (id) next[id] = r.verdict.ok ? r.verdict.supply : null;
          }

          return next;
        })
      )
      .catch(() =>
        setCosts((prev) => ({ ...prev, ...Object.fromEntries([...sentIds.values()].map((id) => [id, null])) }))
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, listSignature, retryTick]);

  const paperLabel = new Map(options?.papers.map((p) => [p.paperno, p.label]));
  const colorLabel = new Map(options?.colors.map((c) => [c.colorno, c.label]));
  const off = new Set(draft.off);
  const labelsOf = (c: PrintComboDto): ComboLabels => ({
    paper: paperLabel.get(c.paperno) ?? String(c.paperno),
    side: colorLabel.get(c.colorno) ?? String(c.colorno),
    qty: qtyLabel(kind, c.qty),
  });

  const knownCosts: Record<string, number> = {};
  for (const c of list) {
    const cost = costs[quoteId(c, { width, height })];
    if (typeof cost === 'number') knownCosts[c.key] = cost;
  }
  const prices = applyTimes(draft.edited, new Set(Object.keys(draft.edited)), knownCosts, times);

  const rows: (OptionRow & { combo: PublishPrintComboDto })[] = list.map((c) => {
    const price = prices[c.key] ?? 0;
    const memberPrice = discountPct ? memberPriceFor(price, discountPct) : null;
    const optionLabels = labelsOf(c);

    return {
      key: c.key,
      label: `${optionLabels.paper} · ${optionLabels.side} · ${optionLabels.qty}`,
      cost: quoteId(c, { width, height }) in costs ? costs[quoteId(c, { width, height })] : undefined,
      price,
      memberPrice,
      on: !off.has(c.key),
      edited: c.key in draft.edited,
      combo: { ...c, price, memberPrice, optionLabels },
    };
  });

  const problems = blockers(
    rows.map((r) => ({ key: r.key, cost: r.cost ?? null, price: r.price, memberPrice: r.memberPrice, on: r.on, labels: r.combo.optionLabels })),
    options?.bleedMatches ?? false
  );
  const pending = rows.filter((r) => r.on && r.cost === undefined).length;
  const selling = rows.flatMap((r) => (r.on && typeof r.cost === 'number' ? [{ price: r.price, cost: r.cost }] : []));
  const canPublish = !!options && problems.length === 0 && pending === 0 && draft.name.trim().length > 0;

  const handleToggleAxis = (axis: AxisName, value: number) => {
    const current = picked[axis];
    if (current.includes(value)) {
      if (current.length > 1) update({ picked: { ...picked, [axis]: current.filter((v) => v !== value) } });

      return;
    }

    const next = { ...picked, [axis]: [...current, value].sort((a, b) => a - b) };
    const nextLabels = options
      ? combos(next, awk, (p, c, q) => qtyAllowed(options.quantities, p, c, q))
          .filter((c) => !off.has(c.key))
          .map((c) => labelsOf(c))
      : [];
    if (gridSize(nextLabels) > COMBO_LIMIT) {
      toast.error(`조합은 ${COMBO_LIMIT}개까지 만들 수 있어요.`);

      return;
    }

    update({ picked: next });
  };

  const handleRetryFailed = () => {
    const failed = Object.keys(costs).filter((key) => costs[key] === null);
    for (const key of failed) requested.current.delete(key);
    setCosts((prev) => Object.fromEntries(Object.entries(prev).filter(([, v]) => v !== null)));
    setRetryTick((n) => n + 1);
  };

  const finish = async (id: string) => {
    try {
      await link.mutateAsync({ id: template.id, productId: id });
      clearDraft(template.id);
      toast.success('게시했어요. 상품과 자동 발주 연결까지 만들었어요.');
      onClose();
    } catch (error) {
      toast.error(serverMessage(error) ?? '상품은 만들었는데 템플릿에 연결하지 못했어요.');
    }
  };

  const handlePublish = async () => {
    if (!canPublish) return;

    setPublishing(true);
    try {
      const { fileId } = await preview.mutateAsync(template.id);
      const result = await publish.mutateAsync({
        templateId: template.id,
        kind,
        width,
        height,
        name: draft.name.trim(),
        description: draft.description.trim(),
        thumbnailFileId: fileId,
        combos: rows.filter((r) => r.on).map((r) => r.combo),
      });
      setMasterId(result.masterId);
      await finish(result.masterId);
    } catch (error) {
      toast.error(serverMessage(error) ?? '게시하지 못했어요. 잠시 뒤 다시 시도해 주세요.');
    } finally {
      setPublishing(false);
    }
  };

  const handleRetryFinish = async () => {
    if (!masterId) return;

    setPublishing(true);
    await finish(masterId);
    setPublishing(false);
  };

  const qtyAxis = options ? qtyChoices(options.quantities) : [];
  const awkLabels = options
    ? options.requiredAwk.flatMap((g) => g.options.filter((o) => awk.includes(o.jobno)).map((o) => `${g.group} ${o.label}`))
    : [];
  const nextDisabled = step === 1 ? !options || !options.bleedMatches || draft.name.trim().length === 0 : false;

  return (
    <Dialog open onOpenChange={(open) => !open && !publishing && onClose()}>
      <DialogContent className="flex max-h-[calc(100vh-48px)] flex-col gap-0 p-0 sm:max-w-[760px]">
        <DialogHeader className="px-6 pt-5">
          <DialogTitle>템플릿 게시하기</DialogTitle>
          <DialogDescription className="sr-only">{template.title}</DialogDescription>
          <div className="mt-3 flex gap-2">
            {STEPS.map((label, i) => (
              <div
                key={label}
                className={cn(
                  'flex-1 border-b-[3px] pb-2.5 text-[13px] font-medium',
                  i + 1 === step ? 'border-foreground' : i + 1 < step ? 'border-muted-foreground/60' : 'text-muted-foreground border-border'
                )}
              >
                {label}
              </div>
            ))}
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {step === 1 && (
            <StepProduct
              thumbnailUrl={thumbnailUrl}
              kindLabel={almondTemplateKindLabel(template.kind)}
              width={width}
              height={height}
              name={draft.name}
              description={draft.description}
              options={options}
              optionsLoading={optionsQuery.isLoading}
              optionsError={optionsQuery.isError}
              onNameChange={(name) => update({ name })}
              onDescriptionChange={(description) => update({ description })}
              onRetryOptions={() => void optionsQuery.refetch()}
            />
          )}
          {step === 2 && options && (
            <StepOptions
              axes={{
                papers: options.papers.map((p) => ({ value: p.paperno, label: p.label })),
                colors: options.colors.map((c) => ({ value: c.colorno, label: c.label })),
                qtys: qtyAxis.map((q) => ({ value: q, label: qtyLabel(kind, q) })),
              }}
              picked={picked}
              onToggleAxis={handleToggleAxis}
              requiredAwkLabels={awkLabels}
              times={times}
              onTimes={(t) => update({ times: t })}
              discountPct={discountPct}
              onDiscount={(pct: DiscountPct) => update({ discountPct: pct })}
              rows={rows}
              onToggleRow={(key, on) =>
                update({ off: on ? draft.off.filter((k) => k !== key) : [...draft.off.filter((k) => k !== key), key] })
              }
              onPriceChange={(key, price) => update({ edited: { ...draft.edited, [key]: price } })}
              onRetryFailed={handleRetryFailed}
            />
          )}
          {step === 3 && (
            <StepConfirm
              thumbnailUrl={thumbnailUrl}
              name={draft.name}
              selling={selling}
              discountPct={discountPct}
              problems={problems}
              pending={pending}
            />
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t px-6 py-3.5">
          <span className="text-muted-foreground text-[13px]">
            {masterId
              ? '상품은 만들었어요. 템플릿 연결만 다시 하면 돼요.'
              : step === 3
                ? '게시하면 상품 생성, 판매가, 자동 발주 연결, 공개가 한 번에 끝나요.'
                : '닫아도 입력은 임시 저장돼요.'}
          </span>
          <div className="flex gap-2">
            {step > 1 && !masterId && (
              <Button variant="outline" disabled={publishing} onClick={() => update({ step: step === 3 ? 2 : 1 })}>
                이전
              </Button>
            )}
            {masterId ? (
              <Button disabled={publishing} onClick={() => void handleRetryFinish()}>
                게시 마무리 다시 시도
              </Button>
            ) : step === 3 ? (
              <Button disabled={!canPublish || publishing} onClick={() => void handlePublish()}>
                {publishing ? '게시하는 중…' : '게시하기'}
              </Button>
            ) : (
              <Button disabled={nextDisabled} onClick={() => update({ step: step === 1 ? 2 : 3 })}>
                다음
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
