'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  TimeSaleValidationError,
  useCreateTimeSale,
  useTimeSaleDetail,
  useTimeSaleProductRows,
  useUpdateTimeSale,
} from '@/lib/services/time-sale';
import {
  applyPercentDiscount,
  applySavedSalePrices,
  validateRows,
  type TimeSaleRow,
} from '../time-sale-model';
import { TimeSaleProductPicker } from '../components/time-sale-product-picker';
import { TimeSaleSelectedList } from '../components/time-sale-selected-list';
import { TimeSalePriceEditor } from '../components/time-sale-price-editor';

const TIME_SALE_LIST_PATH = '/mall/marketing/time-sale';

/** `datetime-local` 은 로컬 시각 문자열만 받는다. ISO 를 그대로 넣으면 값이 안 붙는다. */
const toLocalInput = (iso: string) => {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
};

function Section({
  step,
  title,
  description,
  children,
}: {
  step: number;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-lg border p-4">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <span className="bg-muted flex h-5 w-5 items-center justify-center rounded-full text-xs">
            {step}
          </span>
          {title}
        </h2>
        {description && <p className="text-muted-foreground mt-1 text-xs">{description}</p>}
      </div>
      {children}
    </section>
  );
}

/** 등록과 수정이 같은 화면이다 — 입력·검증·미리보기가 전부 같아 갈라두면 한쪽만 고쳐진다. */
export default function TimeSaleFormTemplate({ generalId }: { generalId?: string }) {
  const router = useRouter();
  const isEdit = Boolean(generalId);

  const [title, setTitle] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [percent, setPercent] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [rows, setRows] = useState<TimeSaleRow[]>([]);
  const [restored, setRestored] = useState(false);

  const { data: detail, isLoading: loadingDetail } = useTimeSaleDetail(generalId ?? null);
  const { data: loadedRows, isFetching } = useTimeSaleProductRows(selectedIds);
  const createTimeSale = useCreateTimeSale();
  const updateTimeSale = useUpdateTimeSale();

  // 편집 진입 시 한 번만 채운다. 이후엔 사용자의 입력이 이긴다.
  useEffect(() => {
    if (!detail || restored) return;
    setTitle(detail.title);
    setStartsAt(toLocalInput(detail.period.startsAt));
    setEndsAt(toLocalInput(detail.period.endsAt));
    setSelectedIds(detail.productIds);
    setRestored(true);
  }, [detail, restored]);

  // 저장돼 있던 세일가를 편집 행에 얹는다. 정가·멤버십가는 상품 응답의 현재 값을 쓴다.
  const [pricesApplied, setPricesApplied] = useState(false);
  useEffect(() => {
    if (!detail || !loadedRows || pricesApplied) return;
    setRows(applySavedSalePrices(loadedRows, detail.savedPrices));
    setPricesApplied(true);
  }, [detail, loadedRows, pricesApplied]);

  // 상품 목록이 바뀌면 이미 입력한 세일가는 유지하고 새 품목만 붙인다.
  const mergedRows = useMemo(() => {
    if (!loadedRows) return [];
    const edited = new Map(rows.map((row) => [row.variantId, row]));
    return loadedRows.map((row) => edited.get(row.variantId) ?? row);
  }, [loadedRows, rows]);

  const errors = validateRows(mergedRows);
  const errorByVariant = new Map(errors.map((error) => [error.variantId, error.message]));

  const toggleProduct = (productId: string) => {
    setSelectedIds((prev) =>
      prev.includes(productId) ? prev.filter((id) => id !== productId) : [...prev, productId]
    );
  };

  const toggleMany = (productIds: string[], next: boolean) => {
    setSelectedIds((prev) => {
      const kept = prev.filter((id) => !productIds.includes(id));
      return next ? [...kept, ...productIds] : kept;
    });
  };

  const fillByPercent = () => {
    const value = Number(percent);
    if (!Number.isFinite(value) || value <= 0 || value >= 100) {
      toast.error('할인율은 1~99 사이여야 합니다.');
      return;
    }
    setRows(applyPercentDiscount(mergedRows, value));
  };

  const isPending = createTimeSale.isPending || updateTimeSale.isPending;

  const submit = async () => {
    if (!title.trim() || !startsAt || !endsAt) {
      toast.error('세일 이름과 기간을 입력하세요.');
      return;
    }
    if (new Date(startsAt) >= new Date(endsAt)) {
      toast.error('종료 시각이 시작 시각보다 뒤여야 합니다.');
      return;
    }
    if (mergedRows.length === 0) {
      toast.error('세일에 올릴 상품을 선택하세요.');
      return;
    }

    const period = {
      startsAt: new Date(startsAt).toISOString(),
      endsAt: new Date(endsAt).toISOString(),
    };

    try {
      if (isEdit && detail) {
        await updateTimeSale.mutateAsync({
          generalId: detail.generalId,
          membershipId: detail.membershipId,
          title: title.trim(),
          period,
          rows: mergedRows,
        });
        toast.success('타임세일이 수정되었습니다.');
      } else {
        await createTimeSale.mutateAsync({ title: title.trim(), period, rows: mergedRows });
        toast.success('타임세일이 등록되었습니다.');
      }
      router.push(TIME_SALE_LIST_PATH);
    } catch (error) {
      toast.error(
        error instanceof TimeSaleValidationError
          ? error.message
          : isEdit
            ? '타임세일 수정에 실패했습니다.'
            : '타임세일 등록에 실패했습니다.'
      );
    }
  };

  if (isEdit && loadingDetail) {
    return (
      <Container>
        <p className="text-muted-foreground p-8 text-sm">불러오는 중…</p>
      </Container>
    );
  }

  return (
    <Container>
      <Header
        title={isEdit ? `타임세일 수정 · ${detail?.title ?? ''}` : '타임세일 등록'}
        subtitle="기간이 끝나면 가격은 자동으로 원래대로 돌아갑니다. 되돌릴 작업이 없습니다."
        right={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => router.push(TIME_SALE_LIST_PATH)}>
              취소
            </Button>
            <Button
              onClick={() => void submit()}
              disabled={isPending || errors.length > 0 || mergedRows.length === 0}
            >
              {errors.length > 0
                ? `세일가 확인 필요 (${errors.length})`
                : isEdit
                  ? '수정'
                  : '등록'}
            </Button>
          </div>
        }
      />

      <div className="space-y-4 p-4">
        <Section step={1} title="세일 정보">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="time-sale-title">세일 이름</Label>
              <Input
                id="time-sale-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="8월 마감 세일"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="time-sale-starts">시작</Label>
              <Input
                id="time-sale-starts"
                type="datetime-local"
                value={startsAt}
                onChange={(event) => setStartsAt(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="time-sale-ends">종료</Label>
              <Input
                id="time-sale-ends"
                type="datetime-local"
                value={endsAt}
                onChange={(event) => setEndsAt(event.target.value)}
              />
            </div>
          </div>
        </Section>

        <Section
          step={2}
          title="대상 상품"
          description="이미 다른 세일에 걸린 상품은 고를 수 없습니다 — 같은 품목이 두 세일에 걸리면 한쪽 가격만 적용됩니다."
        >
          <TimeSaleSelectedList
            rows={mergedRows}
            isLoading={isFetching && selectedIds.length > 0}
            onRemove={toggleProduct}
          />

          <TimeSaleProductPicker
            selectedIds={selectedIds}
            onToggle={toggleProduct}
            onToggleMany={toggleMany}
            ignoreSaleTitle={detail?.title}
          />
        </Section>

        {mergedRows.length > 0 && (
          <Section
            step={3}
            title="세일가"
            description="일반가는 정가에서, 멤버십가는 멤버십가에서 같은 비율로 깎습니다."
          >
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor="time-sale-percent">전체 할인율(%)</Label>
                <Input
                  id="time-sale-percent"
                  type="number"
                  className="w-28"
                  value={percent}
                  onChange={(event) => setPercent(event.target.value)}
                />
              </div>
              <Button type="button" variant="outline" onClick={fillByPercent}>
                전체 채우기
              </Button>
              <p className="text-muted-foreground pb-2 text-xs">
                상품마다 다르게 하려면 아래 상품 줄의 할인율을 쓰세요.
              </p>
            </div>

            <TimeSalePriceEditor
              rows={mergedRows}
              errorByVariant={errorByVariant}
              onChange={setRows}
            />
          </Section>
        )}

        {isFetching && <p className="text-muted-foreground text-xs">가격을 불러오는 중…</p>}
      </div>
    </Container>
  );
}
