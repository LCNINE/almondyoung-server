'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Plus } from 'lucide-react';
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
  summarizeSaleRows,
  validateRows,
  shortSaleNumber,
  resolveTimeSaleStatus,
  TIME_SALE_STATUS_LABEL,
  type TimeSaleRow,
} from '../time-sale-model';
import { TimeSaleWorkspace } from '../components/time-sale-workspace';
import { TimeSaleDialog } from '../components/time-sale-dialog';
import { TimeSaleProductPicker } from '../components/time-sale-product-picker';
import { TimeSaleSelectedList } from '../components/time-sale-selected-list';
import { TimeSalePriceEditor } from '../components/time-sale-price-editor';

const TIME_SALE_LIST_PATH = '/mall/marketing/time-sale';
const MIN_PERIOD_MS = 5 * 60 * 1000;
const minuteNow = () => Math.floor(Date.now() / 60_000) * 60_000;

/** `datetime-local` 은 로컬 시각 문자열만 받는다. ISO 를 그대로 넣으면 값이 안 붙는다. */
const toLocalInput = (iso: string) => {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
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
        {description && (
          <p className="text-muted-foreground mt-1 text-xs">{description}</p>
        )}
      </div>
      {children}
    </section>
  );
}

/** 등록과 수정이 같은 화면이다 — 입력·검증·미리보기가 전부 같아 갈라두면 한쪽만 고쳐진다. */
/**
 * `onClose` 가 있으면 목록 위 모달로, 없으면 단독 페이지로 그린다.
 * 모달은 레퍼런스처럼 둘로 나뉜다 — `info`: 명칭·기간(신규·수정), `products`: 상품진열(상품·세일가).
 */
export default function TimeSaleFormTemplate({
  timeSaleId,
  onClose,
  part,
}: {
  timeSaleId?: string;
  onClose?: () => void;
  part?: 'info' | 'products';
}) {
  const router = useRouter();
  const isEdit = Boolean(timeSaleId);

  const [title, setTitle] = useState('');
  // 신규는 레퍼런스처럼 지금부터 7일로 채워 둔다.
  const [startsAt, setStartsAt] = useState(() =>
    timeSaleId ? '' : toLocalInput(new Date(minuteNow()).toISOString())
  );
  const [endsAt, setEndsAt] = useState(() =>
    timeSaleId
      ? ''
      : toLocalInput(new Date(minuteNow() + 7 * 86_400_000).toISOString())
  );
  const [adding, setAdding] = useState(false);
  const [percent, setPercent] = useState('');
  const [membershipPercent, setMembershipPercent] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [rows, setRows] = useState<TimeSaleRow[]>([]);
  const [restored, setRestored] = useState(false);

  const { data: detail, isLoading: loadingDetail } = useTimeSaleDetail(
    timeSaleId ?? null
  );
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
  const errorByVariant = new Map(
    errors.map((error) => [error.variantId, error.message])
  );
  const saleSummary = summarizeSaleRows(mergedRows);

  const toggleProduct = (productId: string) => {
    setSelectedIds((prev) =>
      prev.includes(productId)
        ? prev.filter((id) => id !== productId)
        : [...prev, productId]
    );
  };

  const toggleMany = (productIds: string[], next: boolean) => {
    setSelectedIds((prev) => {
      const kept = prev.filter((id) => !productIds.includes(id));
      return next ? [...kept, ...productIds] : kept;
    });
  };

  const isValidPercent = (value: number) =>
    Number.isFinite(value) && value > 0 && value < 100;

  const membershipPercentTyped = membershipPercent.trim() !== '';
  const membershipPercentInvalid =
    membershipPercentTyped && !isValidPercent(Number(membershipPercent));
  // 비워두거나 값이 틀리면 일반 할인율을 그대로 쓴다 — 틀린 값이 상품별 적용으로 새면 음수나
  // NaN 세일가가 만들어진다.
  const resolvedMembershipPercent =
    membershipPercentTyped && !membershipPercentInvalid
      ? Number(membershipPercent)
      : null;

  const fillByPercent = () => {
    const value = Number(percent);
    if (!isValidPercent(value)) {
      toast.error('할인율은 1~99 사이여야 합니다.');
      return;
    }
    if (membershipPercentInvalid) {
      toast.error('멤버십 할인율은 1~99 사이여야 합니다.');
      return;
    }
    setRows(
      applyPercentDiscount(
        mergedRows,
        value,
        resolvedMembershipPercent ?? value
      )
    );
  };

  const isPending = createTimeSale.isPending || updateTimeSale.isPending;

  const close = onClose ?? (() => router.push(TIME_SALE_LIST_PATH));
  const showInfo = part !== 'products';
  const showProducts = part !== 'info';
  // 수정은 저장된 세일가까지 다 읽은 뒤에만 저장한다 — 덜 읽은 채 저장하면 가격이 지워진다.
  const ready =
    !isEdit || (!!detail && (detail.productIds.length === 0 || pricesApplied));
  const heading =
    part === 'products' ? (
      <>
        상품진열 [
        <span className="ts-status-detail">
          {detail ? shortSaleNumber(detail.id) : ''} : {detail?.title ?? ''}
        </span>
        ]{' '}
        {detail &&
          (() => {
            const status = resolveTimeSaleStatus(
              detail.period,
              new Date(),
              detail.status
            );
            return status === 'draft' ? (
              <span className="ts-status">비공개</span>
            ) : (
              <>
                <span className="ts-status ts-status-active">공개</span>
                <span className="ts-status-detail">
                  ({TIME_SALE_STATUS_LABEL[status]})
                </span>
              </>
            );
          })()}
      </>
    ) : isEdit ? (
      '타임 세일 수정'
    ) : (
      '신규 타임 세일'
    );

  const submit = async () => {
    if (!title.trim() || !startsAt || !endsAt) {
      toast.error('세일 이름과 기간을 입력하세요.');
      return;
    }
    if (
      new Date(endsAt).getTime() - new Date(startsAt).getTime() <
      MIN_PERIOD_MS
    ) {
      toast.error('종료 시각은 시작 시각보다 5분 이상 뒤여야 합니다.');
      return;
    }
    if (!part && saleSummary.filled === 0) {
      toast.error('세일가를 입력한 품목이 하나도 없습니다.');
      return;
    }

    const period = {
      startsAt: new Date(startsAt).toISOString(),
      endsAt: new Date(endsAt).toISOString(),
    };

    try {
      if (isEdit && detail) {
        await updateTimeSale.mutateAsync({
          id: detail.id,
          title: title.trim(),
          period,
          status: detail.status,
          rows: mergedRows,
        });
        toast.success(
          part === 'products'
            ? '상품진열을 적용하였습니다.'
            : '타임세일이 수정되었습니다.'
        );
      } else {
        await createTimeSale.mutateAsync({
          title: title.trim(),
          period,
          // 모달 신규는 상품 없이 만든다. 상품을 진열한 뒤 공개한다.
          status: part ? 'draft' : 'active',
          rows: mergedRows,
        });
        toast.success('타임세일이 등록되었습니다.');
      }
      close();
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

  const body =
    isEdit && loadingDetail ? (
      <p className="ts-empty">불러오는 중…</p>
    ) : (
      <div className="space-y-4">
        {showInfo && (
          <div className="ts-form-grid">
            <fieldset className="ts-form-field ts-span-all">
              <legend>
                명칭<span className="text-red-600">*</span>
              </legend>
              <input
                aria-label="명칭"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </fieldset>
            <div className="ts-span-all">
              <fieldset className="ts-form-field">
                <legend>기간</legend>
                <div className="ts-period-inputs">
                  <input
                    type="datetime-local"
                    step={1}
                    aria-label="시작"
                    value={startsAt}
                    onChange={(event) => setStartsAt(event.target.value)}
                  />
                  ~
                  <input
                    type="datetime-local"
                    step={1}
                    aria-label="종료"
                    value={endsAt}
                    onChange={(event) => setEndsAt(event.target.value)}
                  />
                </div>
              </fieldset>
              <p className="ts-field-hint">
                └ 5분 이상 차이가 나도록 설정해 주세요.
              </p>
            </div>
          </div>
        )}

        {showProducts && part === 'products' && (
          <div className="ts-list-toolbar">
            <span className="ts-count">{selectedIds.length}</span>
            <div className="ts-toolbar-spacer" />
            <button
              type="button"
              className="ts-button"
              onClick={() => setAdding((value) => !value)}
            >
              <Plus size={16} />
              상품 추가
            </button>
          </div>
        )}

        {part === 'products' && (
          <>
            <TimeSaleSelectedList
              rows={mergedRows}
              isLoading={isFetching && selectedIds.length > 0}
              onRemove={toggleProduct}
            />
            {adding && (
              <TimeSaleProductPicker
                selectedIds={selectedIds}
                onToggle={toggleProduct}
                onToggleMany={toggleMany}
                excludeId={timeSaleId}
              />
            )}
          </>
        )}

        {!part && (
          <Section
            step={1}
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
              excludeId={timeSaleId}
            />
          </Section>
        )}

        {showProducts && mergedRows.length > 0 && (
          <Section
            step={2}
            title="세일가"
            description="일반가는 정가에서, 멤버십가는 멤버십가에서 깎습니다. 세일가를 비운 품목은 세일에서 빠집니다."
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
              <div className="space-y-1">
                <Label htmlFor="time-sale-membership-percent">
                  멤버십 할인율(%)
                </Label>
                <Input
                  id="time-sale-membership-percent"
                  type="number"
                  className="w-28"
                  placeholder={percent || '동일'}
                  value={membershipPercent}
                  onChange={(event) => setMembershipPercent(event.target.value)}
                />
                {membershipPercentInvalid && (
                  <p className="text-xs text-red-600">1~99 사이로 넣으세요.</p>
                )}
              </div>
              <Button
                type="button"
                variant="outline"
                disabled={membershipPercentInvalid}
                onClick={fillByPercent}
              >
                전체 채우기
              </Button>
              <p className="text-muted-foreground pb-2 text-xs">
                상품마다 다르게 하려면 아래 상품 줄의 할인율을 쓰세요.
              </p>
            </div>

            <p className="text-muted-foreground text-xs">
              멤버십가가 이미 많이 깎여 있으면 같은 할인율로는 구독자에게 값이
              안 변합니다 — 둘 중 싼 값이 적용되기 때문입니다. 그럴 땐 멤버십
              할인율을 낮춰 잡으세요.
            </p>

            <TimeSalePriceEditor
              rows={mergedRows}
              errorByVariant={errorByVariant}
              membershipPercent={resolvedMembershipPercent}
              disabled={membershipPercentInvalid}
              onChange={setRows}
            />

            <p className="text-muted-foreground text-xs">
              세일에 들어갈 품목 {saleSummary.filled}개 / 고른 품목{' '}
              {saleSummary.total}개
            </p>
          </Section>
        )}

        {showProducts && isFetching && (
          <p className="text-muted-foreground text-xs">가격을 불러오는 중…</p>
        )}
      </div>
    );

  const submitButton = (
    <button
      type="button"
      className="ts-button"
      onClick={() => void submit()}
      disabled={
        isPending ||
        !ready ||
        !title.trim() ||
        errors.length > 0 ||
        (!part && saleSummary.filled === 0)
      }
    >
      {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {errors.length > 0
        ? `세일가 확인 필요 (${errors.length})`
        : part === 'products'
          ? '적용'
          : isEdit
            ? '수정'
            : '생성'}
    </button>
  );

  if (onClose) {
    return (
      <TimeSaleDialog
        open
        title={heading}
        onClose={onClose}
        footer={submitButton}
        width={part === 'products' ? 1250 : 900}
      >
        {body}
      </TimeSaleDialog>
    );
  }

  return (
    <TimeSaleWorkspace>
      <div className="ts-management">
        <div className="ts-list-intro">
          <h1>{heading}</h1>
        </div>
        <div className="px-6 pb-4">{body}</div>
        <footer className="ts-modal-footer">
          {submitButton}
          <button
            type="button"
            className="ts-button ts-button-neutral"
            onClick={close}
          >
            닫기
          </button>
        </footer>
      </div>
    </TimeSaleWorkspace>
  );
}
