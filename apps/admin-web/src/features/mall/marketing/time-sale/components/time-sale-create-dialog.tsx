'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { medusaCatalogApi, type MedusaProductItem } from '@/lib/api/domains/medusa/catalog';
import {
  TimeSaleValidationError,
  useCreateTimeSale,
  useMembershipPriceListId,
  useTimeSaleProductRows,
} from '@/lib/services/time-sale';
import { applyPercentDiscount, validateRows, type TimeSaleRow } from '../time-sale-model';

const won = (value: number) => `${value.toLocaleString('ko-KR')}원`;

function ProductPicker({
  selected,
  onToggle,
}: {
  selected: MedusaProductItem[];
  onToggle: (product: MedusaProductItem) => void;
}) {
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState<MedusaProductItem[]>([]);
  const [searching, setSearching] = useState(false);

  const search = async () => {
    setSearching(true);
    try {
      const { products } = await medusaCatalogApi.searchProducts(keyword);
      setResults(products);
    } catch {
      toast.error('상품을 불러오지 못했습니다.');
    } finally {
      setSearching(false);
    }
  };

  const selectedIds = new Set(selected.map((product) => product.id));

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void search();
            }
          }}
          placeholder="상품명으로 검색"
        />
        <Button type="button" variant="outline" onClick={() => void search()} disabled={searching}>
          검색
        </Button>
      </div>

      {results.length > 0 && (
        <div className="max-h-40 overflow-y-auto rounded border">
          {results.map((product) => (
            <button
              key={product.id}
              type="button"
              onClick={() => onToggle(product)}
              className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted ${
                selectedIds.has(product.id) ? 'bg-muted' : ''
              }`}
            >
              <span className="truncate">{product.title}</span>
              <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                {selectedIds.has(product.id) ? '선택됨' : '추가'}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function TimeSaleCreateDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [title, setTitle] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [percent, setPercent] = useState<number | ''>('');
  const [selected, setSelected] = useState<MedusaProductItem[]>([]);
  const [rows, setRows] = useState<TimeSaleRow[]>([]);

  const membershipPriceListId = useMembershipPriceListId();
  const productIds = useMemo(() => selected.map((product) => product.id), [selected]);
  const { data: loadedRows, isFetching } = useTimeSaleProductRows(productIds, membershipPriceListId);
  const createTimeSale = useCreateTimeSale();

  // 상품 목록이 바뀌면 이미 입력한 세일가는 유지하고 새 품목만 붙인다.
  const mergedRows = useMemo(() => {
    if (!loadedRows) return [];
    const edited = new Map(rows.map((row) => [row.variantId, row]));
    return loadedRows.map((row) => edited.get(row.variantId) ?? row);
  }, [loadedRows, rows]);

  const errors = validateRows(mergedRows);
  const errorByVariant = new Map(errors.map((error) => [error.variantId, error.message]));

  const toggleProduct = (product: MedusaProductItem) => {
    setSelected((prev) =>
      prev.some((item) => item.id === product.id)
        ? prev.filter((item) => item.id !== product.id)
        : [...prev, product]
    );
  };

  const fillByPercent = () => {
    if (percent === '' || percent <= 0 || percent >= 100) {
      toast.error('할인율은 1~99 사이여야 합니다.');
      return;
    }
    setRows(applyPercentDiscount(mergedRows, Number(percent)));
  };

  const editRow = (variantId: string, field: 'generalSalePrice' | 'membershipSalePrice', raw: string) => {
    const value = raw === '' ? null : Number(raw);
    setRows(
      mergedRows.map((row) => (row.variantId === variantId ? { ...row, [field]: value } : row))
    );
  };

  const reset = () => {
    setTitle('');
    setStartsAt('');
    setEndsAt('');
    setPercent('');
    setSelected([]);
    setRows([]);
  };

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

    try {
      await createTimeSale.mutateAsync({
        title: title.trim(),
        period: {
          startsAt: new Date(startsAt).toISOString(),
          endsAt: new Date(endsAt).toISOString(),
        },
        rows: mergedRows,
      });
      toast.success('타임세일이 등록되었습니다.');
      reset();
      onOpenChange(false);
    } catch (error) {
      const message =
        error instanceof TimeSaleValidationError
          ? error.message
          : '타임세일 등록에 실패했습니다.';
      toast.error(message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>타임세일 등록</DialogTitle>
          <DialogDescription>
            기간이 끝나면 가격은 자동으로 원래대로 돌아갑니다. 되돌릴 작업이 없습니다.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
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

          <div className="space-y-1">
            <Label>대상 상품</Label>
            <ProductPicker selected={selected} onToggle={toggleProduct} />
            {selected.length > 0 && (
              <p className="text-xs text-muted-foreground">{selected.length}개 상품 선택됨</p>
            )}
          </div>

          {mergedRows.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-end gap-2">
                <div className="space-y-1">
                  <Label htmlFor="time-sale-percent">일괄 할인율(%)</Label>
                  <Input
                    id="time-sale-percent"
                    type="number"
                    className="w-28"
                    value={percent}
                    onChange={(event) =>
                      setPercent(event.target.value === '' ? '' : Number(event.target.value))
                    }
                  />
                </div>
                <Button type="button" variant="outline" onClick={fillByPercent}>
                  일괄 채우기
                </Button>
                <p className="pb-2 text-xs text-muted-foreground">
                  일반가는 정가에서, 멤버십가는 멤버십가에서 같은 비율로 깎습니다.
                </p>
              </div>

              <div className="max-h-72 overflow-auto rounded border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted text-xs">
                    <tr>
                      <th className="px-3 py-2 text-left">상품 / 품목</th>
                      <th className="px-3 py-2 text-right">정가</th>
                      <th className="px-3 py-2 text-right">일반 세일가</th>
                      <th className="px-3 py-2 text-right">멤버십가</th>
                      <th className="px-3 py-2 text-right">멤버십 세일가</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mergedRows.map((row) => {
                      const error = errorByVariant.get(row.variantId);
                      return (
                        <tr key={row.variantId} className="border-t">
                          <td className="px-3 py-2">
                            <div className="truncate">{row.productTitle}</div>
                            <div className="text-xs text-muted-foreground">{row.variantTitle}</div>
                            {error && <div className="text-xs text-red-600">{error}</div>}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                            {won(row.basePrice)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Input
                              type="number"
                              className="ml-auto w-28 text-right"
                              value={row.generalSalePrice ?? ''}
                              onChange={(event) =>
                                editRow(row.variantId, 'generalSalePrice', event.target.value)
                              }
                            />
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                            {row.membershipBasePrice === null ? '—' : won(row.membershipBasePrice)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {row.membershipBasePrice === null ? (
                              <span className="text-xs text-muted-foreground">해당 없음</span>
                            ) : (
                              <Input
                                type="number"
                                className="ml-auto w-28 text-right"
                                value={row.membershipSalePrice ?? ''}
                                onChange={(event) =>
                                  editRow(row.variantId, 'membershipSalePrice', event.target.value)
                                }
                              />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {isFetching && <p className="text-xs text-muted-foreground">가격을 불러오는 중…</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={createTimeSale.isPending || errors.length > 0 || mergedRows.length === 0}
          >
            {errors.length > 0 ? `세일가 확인 필요 (${errors.length})` : '등록'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
