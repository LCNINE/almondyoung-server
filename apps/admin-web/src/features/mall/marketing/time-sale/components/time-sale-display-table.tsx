'use client';

import {
  Fragment,
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import type { MedusaProductMeta } from '@/lib/api/domains/medusa/catalog';
import { resolvePublicFileUrl } from '@/lib/utils/file-url';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { applyPercentDiscount, type TimeSaleRow } from '../time-sale-model';
import { saleToast } from './time-sale-workspace';

const STOREFRONT_URL = (process.env.NEXT_PUBLIC_STOREFRONT_URL ?? '').replace(
  /\/+$/,
  ''
);

const EMPTY_ROWS: TimeSaleRow[] = [];

const won = (value: number) => value.toLocaleString('ko-KR');

const range = (values: number[]) => {
  if (values.length === 0) return '-';
  const min = Math.min(...values);
  const max = Math.max(...values);
  return min === max ? won(min) : `${won(min)}~${won(max)}`;
};

// 모든 옵션이 같은 값이면 그 값, 아니면 비운다(자리표시자에 범위가 보인다).
const commonValue = (values: number[], total: number) =>
  values.length === total && values.length > 0 && new Set(values).size === 1
    ? values[0]
    : null;

const percentOf = (base: number, sale: number | null) =>
  sale === null || base <= 0 ? null : Math.round((1 - sale / base) * 100);

// 재고를 관리하고 백오더를 막은 품목이 전부 0 이하면 품절이다.
const isSoldOut = (meta: MedusaProductMeta | undefined) => {
  const variants = meta?.variants ?? [];
  return (
    variants.length > 0 &&
    variants.every(
      (v) =>
        v.manage_inventory &&
        !v.allow_backorder &&
        (v.inventory_quantity ?? 0) <= 0
    )
  );
};

function PriceInput({
  value,
  onChange,
  hint,
  placeholder,
  alert = false,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  hint?: string;
  placeholder?: string;
  /** 저장 도중 중단돼 이전 값이 남은 품목. 안내를 빨갛게 보인다. */
  alert?: boolean;
}) {
  return (
    <div className="ts-display-price">
      <input
        type="number"
        placeholder={placeholder}
        value={value ?? ''}
        onChange={(event) =>
          onChange(
            event.target.value === '' ? null : Number(event.target.value)
          )
        }
      />
      {hint && (
        <small className={alert ? 'ts-display-hint-alert' : ''}>{hint}</small>
      )}
    </div>
  );
}

/**
 * 진열 상품 검색. 입력 상태를 표와 분리해 글자마다 230개 줄을 다시 그리지 않는다.
 * 걸린 상품이 여럿이면 Enter 마다 다음 상품으로 넘어간다.
 */
function DisplaySearch({
  index,
  onJump,
}: {
  index: { id: string; text: string }[];
  onJump: (id: string) => void;
}) {
  const [keyword, setKeyword] = useState('');
  const [position, setPosition] = useState(-1);
  // 개수 계산은 입력보다 뒤로 미룬다 — 한글은 자모마다 바뀌어 글자보다 자주 다시 센다.
  const q = useDeferredValue(keyword.trim().toLowerCase());
  const matches = useMemo(
    () =>
      q
        ? index.filter((item) => item.text.includes(q)).map((item) => item.id)
        : [],
    [index, q]
  );

  return (
    <span className="ts-display-search">
      <input
        type="search"
        aria-label="진열 상품 검색"
        placeholder="상품명·상품번호·상품코드"
        value={keyword}
        onChange={(event) => {
          setKeyword(event.target.value);
          setPosition(-1);
        }}
        onKeyDown={(event) => {
          if (
            event.key !== 'Enter' ||
            event.nativeEvent.isComposing ||
            !matches.length
          )
            return;
          event.preventDefault();
          const next = (position + 1) % matches.length;
          setPosition(next);
          onJump(matches[next]);
        }}
      />
      {q && (matches.length ? `${position + 1} / ${matches.length}` : '없음')}
    </span>
  );
}

/**
 * 세일가 일괄 채우기. 입력 상태를 표와 분리하고, 덮어쓰기 전에 확인을 받는다.
 * 채우기는 화면 값만 바꾼다 — 저장은 모달의 [적용] 이다.
 */
function BulkFill({
  targetCount,
  selected,
  onFill,
}: {
  targetCount: number;
  selected: boolean;
  onFill: (percent: number, membershipPercent: number) => void;
}) {
  const [percent, setPercent] = useState('');
  const [membershipPercent, setMembershipPercent] = useState('');
  const [confirm, setConfirm] = useState<{
    general: number;
    membership: number;
  } | null>(null);

  const valid = (n: number) => Number.isFinite(n) && n > 0 && n < 100;

  const ask = () => {
    const general = Number(percent);
    // 멤버십 칸을 비우면 같은 비율을 쓴다.
    const membership = membershipPercent.trim()
      ? Number(membershipPercent)
      : general;
    if (!percent.trim() || !valid(general) || !valid(membership)) {
      saleToast('할인율은 1~99 사이로 넣으세요.', true);
      return;
    }
    setConfirm({ general, membership });
  };

  const scope = `${selected ? '선택한' : '전체'} ${targetCount}개 상품`;

  return (
    <span className="ts-display-fill">
      일괄 할인 · 기간판매가
      <input
        type="number"
        aria-label="기간판매가 일괄 할인율"
        value={percent}
        onChange={(event) => setPercent(event.target.value)}
      />
      % · 멤버십 기간판매가
      <input
        type="number"
        aria-label="멤버십 기간판매가 일괄 할인율"
        placeholder={percent ? `${percent}(같게)` : '같게'}
        value={membershipPercent}
        onChange={(event) => setMembershipPercent(event.target.value)}
      />
      %
      <button
        type="button"
        className="ts-button ts-button-neutral"
        disabled={!targetCount}
        onClick={ask}
      >
        {scope}에 채우기
      </button>
      <AlertDialog
        open={!!confirm}
        onOpenChange={(open) => !open && setConfirm(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>세일가 일괄 채우기</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="break-keep">
                <p>{scope}의 세일가를 아래 값으로 바꿉니다.</p>
                <p>이미 입력된 세일가는 덮어씁니다.</p>
                <ul className="mt-2 list-disc pl-5">
                  <li>기간판매가: 기존 판매가에서 {confirm?.general}% 할인</li>
                  <li>
                    멤버십 기간판매가: 기존 멤버십가에서 {confirm?.membership}%
                    할인
                  </li>
                </ul>
                <p className="mt-2">쇼핑몰 반영은 [적용]을 눌러야 됩니다.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!confirm) return;
                onFill(confirm.general, confirm.membership);
                setConfirm(null);
              }}
            >
              채우기
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </span>
  );
}

type RowProps = {
  productId: string;
  index: number;
  variants: TimeSaleRow[];
  info: MedusaProductMeta | undefined;
  status: ReactNode;
  checked: boolean;
  hit: boolean;
  expanded: boolean;
  error: string | undefined;
  previousGeneral: Record<string, number> | undefined;
  previousMembership: Record<string, number> | undefined;
  onToggleCheck: (productId: string) => void;
  onToggleOpen: (productId: string) => void;
  onVariant: (variantId: string, patch: Partial<TimeSaleRow>) => void;
  onProduct: (
    productId: string,
    field: 'generalSalePrice' | 'membershipSalePrice',
    value: number | null
  ) => void;
};

/**
 * 상품 한 줄. 값이 바뀐 줄만 다시 그린다 — 230개 상품·옵션 수천 줄을 입력마다 전부 그리면 버벅인다.
 * `variants` 는 매번 새 배열이라 원소(행 객체)로 비교한다. 바뀌지 않은 행은 같은 객체를 유지한다.
 */
const ProductRow = memo(
  function ProductRow({
    productId,
    index,
    variants,
    info,
    status,
    checked,
    hit,
    expanded,
    error,
    previousGeneral,
    previousMembership,
    onToggleCheck,
    onToggleOpen,
    onVariant,
    onProduct,
  }: RowProps) {
    const prevG = (id: string) => previousGeneral?.[id];
    const prevM = (id: string) => previousMembership?.[id];
    const prevText = (value: number | undefined) =>
      value === undefined ? '' : `이전 값 ${won(value)}`;
    const hasPrevious = variants.some(
      (row) =>
        prevG(row.variantId) !== undefined || prevM(row.variantId) !== undefined
    );
    const first = variants[0];
    const single = variants.length === 1;
    const published = info?.status === 'published';
    const soldOut = isSoldOut(info);
    const salePrices = variants.flatMap((row) =>
      row.generalSalePrice === null ? [] : [row.generalSalePrice]
    );
    const membershipPrices = variants.flatMap((row) =>
      row.membershipSalePrice === null ? [] : [row.membershipSalePrice]
    );
    const membershipBases = variants.flatMap((row) =>
      row.membershipBasePrice === null ? [] : [row.membershipBasePrice]
    );
    const percents = variants.flatMap((row) => {
      const value = percentOf(row.basePrice, row.generalSalePrice);
      return value === null ? [] : [value];
    });

    return (
      <>
        <tr
          data-product-row={productId}
          className={hit ? 'ts-display-hit' : checked ? 'ts-row-selected' : ''}
        >
          <td>
            <input
              type="checkbox"
              aria-label={`${first?.productTitle ?? productId} 선택`}
              checked={checked}
              onChange={() => onToggleCheck(productId)}
            />
          </td>
          <td>{index + 1}</td>
          <td>{status}</td>
          <td>{productId.slice(-8)}</td>
          <td className="ts-display-code">
            <div
              className="ts-display-clip"
              title={info?.variants?.[0]?.sku ?? undefined}
            >
              {info?.variants?.[0]?.sku || '-'}
            </div>
          </td>
          <td className="ts-name ts-display-name">
            <div className="ts-display-clip" title={first?.productTitle}>
              {first?.productTitle ?? '불러오는 중…'}
            </div>
            {!single && variants.length > 0 && (
              <button
                type="button"
                className="ts-display-options"
                onClick={() => onToggleOpen(productId)}
              >
                옵션 {variants.length}개 {expanded ? '▲' : '▼'}
              </button>
            )}
            {error && <p className="ts-display-error">{error}</p>}
          </td>
          <td className={published ? 'ts-yes' : 'ts-no'}>
            {info ? (published ? '예' : '아니오') : '-'}
          </td>
          <td className={published ? 'ts-yes' : 'ts-no'}>
            {info ? (published ? '예' : '아니오') : '-'}
          </td>
          <td className={soldOut ? 'ts-no' : 'ts-yes'}>
            {info ? (soldOut ? '예' : '아니오') : '-'}
          </td>
          <td>
            {info?.thumbnail ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                className="ts-display-thumb"
                src={resolvePublicFileUrl(info.thumbnail) ?? ''}
                alt=""
              />
            ) : (
              '-'
            )}
          </td>
          <td>
            {info?.handle && STOREFRONT_URL ? (
              <a
                className="ts-display-detail"
                href={`${STOREFRONT_URL}/kr/products/${info.handle}`}
                target="_blank"
                rel="noreferrer"
              >
                상품상세
              </a>
            ) : (
              '-'
            )}
          </td>
          <td>-</td>
          <td>{range(variants.map((row) => row.basePrice))}</td>
          <td>
            {percents.length
              ? Math.min(...percents) === Math.max(...percents)
                ? `${percents[0]}%`
                : `${Math.min(...percents)}~${Math.max(...percents)}%`
              : ''}
          </td>
          <td>
            {single && first ? (
              <PriceInput
                value={first.generalSalePrice}
                hint={prevText(prevG(first.variantId)) || undefined}
                alert={prevG(first.variantId) !== undefined}
                onChange={(value) =>
                  onVariant(first.variantId, { generalSalePrice: value })
                }
              />
            ) : (
              // 옵션 전부에 같은 값을 넣는다. 옵션별로 다르게 하려면 펼쳐서 고친다.
              <PriceInput
                value={commonValue(salePrices, variants.length)}
                placeholder={range(salePrices)}
                hint={
                  hasPrevious
                    ? '이전 값 있음'
                    : `옵션 ${salePrices.length}/${variants.length}개 세일`
                }
                alert={hasPrevious}
                onChange={(value) =>
                  onProduct(productId, 'generalSalePrice', value)
                }
              />
            )}
          </td>
          <td>
            {single && first ? (
              first.membershipBasePrice === null ? (
                '-'
              ) : (
                <PriceInput
                  value={first.membershipSalePrice}
                  hint={
                    prevM(first.variantId) !== undefined
                      ? prevText(prevM(first.variantId))
                      : `기존 멤버십가 ${won(first.membershipBasePrice)}`
                  }
                  alert={prevM(first.variantId) !== undefined}
                  onChange={(value) =>
                    onVariant(first.variantId, { membershipSalePrice: value })
                  }
                />
              )
            ) : membershipBases.length === 0 ? (
              '-'
            ) : (
              <PriceInput
                value={commonValue(membershipPrices, membershipBases.length)}
                placeholder={range(membershipPrices)}
                hint={`기존 멤버십가 ${range(membershipBases)}`}
                onChange={(value) =>
                  onProduct(productId, 'membershipSalePrice', value)
                }
              />
            )}
          </td>
        </tr>
        {!single &&
          expanded &&
          variants.map((row) => {
            const percent = percentOf(row.basePrice, row.generalSalePrice);
            return (
              <tr key={row.variantId} className="ts-display-variant">
                <td colSpan={5} />
                <td className="ts-name">└ {row.variantTitle}</td>
                <td colSpan={6} />
                <td>{won(row.basePrice)}</td>
                <td>{percent === null ? '' : `${percent}%`}</td>
                <td>
                  <PriceInput
                    value={row.generalSalePrice}
                    hint={prevText(prevG(row.variantId)) || undefined}
                    alert={prevG(row.variantId) !== undefined}
                    onChange={(value) =>
                      onVariant(row.variantId, { generalSalePrice: value })
                    }
                  />
                </td>
                <td>
                  {row.membershipBasePrice === null ? (
                    '-'
                  ) : (
                    <PriceInput
                      value={row.membershipSalePrice}
                      hint={
                        prevM(row.variantId) !== undefined
                          ? prevText(prevM(row.variantId))
                          : `기존 멤버십가 ${won(row.membershipBasePrice)}`
                      }
                      alert={prevM(row.variantId) !== undefined}
                      onChange={(value) =>
                        onVariant(row.variantId, { membershipSalePrice: value })
                      }
                    />
                  )}
                </td>
              </tr>
            );
          })}
      </>
    );
  },
  (prev, next) => {
    for (const key of Object.keys(next) as (keyof RowProps)[]) {
      if (key === 'variants') continue;
      if (prev[key] !== next[key]) return false;
    }
    return (
      prev.variants.length === next.variants.length &&
      prev.variants.every((row, i) => row === next.variants[i])
    );
  }
);

/**
 * 상품진열 표(레퍼런스 SweetOffer 상품진열 화면). 한 줄이 상품 하나이고, 옵션이 여러 개면 펼쳐서
 * 품목별 기간판매가를 고친다. 순서는 `productIds` 가 진열순위다.
 */
export function TimeSaleDisplayTable({
  productIds,
  rows,
  meta,
  status,
  errorByVariant,
  previousGeneral,
  previousMembership,
  adding,
  picker,
  onToggleAdding,
  onRefresh,
  onReorder,
  onRemove,
  onRowsChange,
}: {
  productIds: string[];
  rows: TimeSaleRow[];
  meta: Map<string, MedusaProductMeta> | undefined;
  status: ReactNode;
  errorByVariant: Map<string, string>;
  previousGeneral?: Record<string, number>;
  previousMembership?: Record<string, number>;
  adding: boolean;
  picker: ReactNode;
  onToggleAdding: () => void;
  onRefresh: () => void;
  onReorder: (next: string[]) => void;
  onRemove: (ids: string[]) => void;
  onRowsChange: (rows: TimeSaleRow[]) => void;
}) {
  const [checked, setChecked] = useState<string[]>([]);
  const [open, setOpen] = useState<string[]>([]);
  const [hit, setHit] = useState<string | null>(null);

  // 줄 콜백을 고정하려고 최신 rows·onRowsChange 를 ref 로 읽는다. 콜백이 매번 바뀌면 모든 줄이 다시 그려진다.
  const latest = useRef({ rows, onRowsChange });
  useEffect(() => {
    latest.current = { rows, onRowsChange };
  });

  // 피커는 진열 목록 맨 아래에 붙는다. 상품이 많으면 열어도 화면 밖이라 그 자리로 내려 준다.
  const pickerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (adding) pickerRef.current?.scrollIntoView({ block: 'start' });
  }, [adding]);

  const onVariant = useCallback(
    (variantId: string, patch: Partial<TimeSaleRow>) => {
      const { rows, onRowsChange } = latest.current;
      onRowsChange(
        rows.map((row) =>
          row.variantId === variantId ? { ...row, ...patch } : row
        )
      );
    },
    []
  );

  const onProduct = useCallback(
    (
      productId: string,
      field: 'generalSalePrice' | 'membershipSalePrice',
      value: number | null
    ) => {
      const { rows, onRowsChange } = latest.current;
      onRowsChange(
        rows.map((row) =>
          row.productId === productId &&
          (field === 'generalSalePrice' || row.membershipBasePrice !== null)
            ? { ...row, [field]: value }
            : row
        )
      );
    },
    []
  );

  const onToggleCheck = useCallback(
    (productId: string) =>
      setChecked((prev) =>
        prev.includes(productId)
          ? prev.filter((id) => id !== productId)
          : [...prev, productId]
      ),
    []
  );

  const onToggleOpen = useCallback(
    (productId: string) =>
      setOpen((prev) =>
        prev.includes(productId)
          ? prev.filter((id) => id !== productId)
          : [...prev, productId]
      ),
    []
  );

  const rowsByProduct = useMemo(() => {
    const map = new Map<string, TimeSaleRow[]>();
    for (const row of rows) {
      const bucket = map.get(row.productId);
      if (bucket) bucket.push(row);
      else map.set(row.productId, [row]);
    }
    return map;
  }, [rows]);

  // 검색용 문자열(상품명·상품번호·상품코드)은 상품 목록이 바뀔 때만 만든다.
  const searchIndex = useMemo(
    () =>
      productIds.map((id) => ({
        id,
        text: [
          rowsByProduct.get(id)?.[0]?.productTitle ?? '',
          id.slice(-8),
          meta?.get(id)?.variants?.[0]?.sku ?? '',
        ]
          .join(' ')
          .toLowerCase(),
      })),
    [productIds, rowsByProduct, meta]
  );

  const jumpTo = useCallback((id: string) => {
    setHit(id);
    document
      .querySelector(`[data-product-row="${id}"]`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, []);

  // 체크한 상품을 맨 위·한 칸 위·한 칸 아래·맨 아래로 옮긴다.
  const move = (where: 'top' | 'up' | 'down' | 'bottom') => {
    const picked = productIds.filter((id) => checked.includes(id));
    const rest = productIds.filter((id) => !checked.includes(id));
    if (where === 'top') return onReorder([...picked, ...rest]);
    if (where === 'bottom') return onReorder([...rest, ...picked]);

    const next = [...productIds];
    const indexes = picked.map((id) => next.indexOf(id));
    const ordered = where === 'up' ? indexes : [...indexes].reverse();
    for (const index of ordered) {
      const target = where === 'up' ? index - 1 : index + 1;
      if (target < 0 || target >= next.length || checked.includes(next[target]))
        continue;
      [next[index], next[target]] = [next[target], next[index]];
    }
    onReorder(next);
  };

  const fill = (general: number, membership: number) => {
    const targets = new Set(checked.length ? checked : productIds);
    const filled = new Map(
      applyPercentDiscount(
        rows.filter((row) => targets.has(row.productId)),
        general,
        membership
      ).map((row) => [row.variantId, row])
    );
    onRowsChange(rows.map((row) => filled.get(row.variantId) ?? row));
  };

  const allChecked =
    productIds.length > 0 && checked.length === productIds.length;
  const checkedSet = new Set(checked);
  const openSet = new Set(open);

  return (
    <div className="ts-display">
      <details className="ts-display-notice">
        <summary>안내 및 주의 사항</summary>
        <ul>
          <li className="ts-notice-strong">
            공개 중인 타임세일은 [적용]을 누르는 즉시 쇼핑몰 가격에 반영됩니다.
          </li>
          <li className="ts-notice-strong">
            기간판매가를 비운 품목은 세일에서 빠지고, 종료 후에는 판매가로 자동
            복원됩니다.
          </li>
          <li>이미 다른 타임세일에 걸린 상품은 추가할 수 없습니다.</li>
          <li>
            진열순위는 쇼핑몰 타임세일 매대의 상품 순서입니다. 순위가 없는
            상품은 판매순으로 뒤에 붙습니다.
          </li>
          <li>
            멤버십가가 있는 상품은 멤버십 기간판매가를 따로 넣을 수 있으며,
            구독자에게는 둘 중 싼 값이 적용됩니다.
          </li>
        </ul>
      </details>
      <details className="ts-display-notice">
        <summary>용어 설명</summary>
        <ul>
          <li>
            기존 판매가: 타임세일 전 일반 판매가(멤버십가 아님). 세일이 끝나면
            이 가격으로 돌아갑니다.
          </li>
          <li>기간할인율: 기존 판매가 대비 기간판매가의 할인율</li>
          <li>기간판매가: 타임세일 기간 동안의 판매가</li>
          <li>
            멤버십 기간판매가: 멤버십 구독자에게 적용되는 타임세일 기간 판매가
          </li>
          <li>
            기존 멤버십가: 타임세일 전 멤버십 회원 가격. 멤버십 할인율은 이 값을
            기준으로 계산합니다.
          </li>
          <li>진열·판매: 쇼핑몰 상품 공개 여부</li>
          <li>품절: 재고를 관리하는 모든 옵션의 재고가 0인 상품</li>
        </ul>
      </details>

      <div className="ts-list-toolbar">
        <button
          type="button"
          className="ts-icon-button"
          aria-label="맨 위로"
          disabled={!checked.length}
          onClick={() => move('top')}
        >
          <ArrowUp size={20} />
        </button>
        <button
          type="button"
          className="ts-icon-button"
          aria-label="위로"
          disabled={!checked.length}
          onClick={() => move('up')}
        >
          <ChevronUp size={20} />
        </button>
        <button
          type="button"
          className="ts-icon-button"
          aria-label="아래로"
          disabled={!checked.length}
          onClick={() => move('down')}
        >
          <ChevronDown size={20} />
        </button>
        <button
          type="button"
          className="ts-icon-button"
          aria-label="맨 아래로"
          disabled={!checked.length}
          onClick={() => move('bottom')}
        >
          <ArrowDown size={20} />
        </button>
        <span className="ts-count">
          {checked.length} / {productIds.length}
        </span>
        <BulkFill
          targetCount={checked.length || productIds.length}
          selected={checked.length > 0}
          onFill={fill}
        />
        <div className="ts-toolbar-spacer" />
        <DisplaySearch index={searchIndex} onJump={jumpTo} />
        <button
          type="button"
          className="ts-icon-button"
          aria-label="새로고침"
          onClick={onRefresh}
        >
          <RefreshCw size={21} />
        </button>
        <button type="button" className="ts-button" onClick={onToggleAdding}>
          <Plus size={16} />
          상품 추가
        </button>
        <button
          type="button"
          className="ts-button ts-button-neutral"
          disabled={!checked.length}
          onClick={() => {
            onRemove(checked);
            setChecked([]);
          }}
        >
          <Trash2 size={13} />
          삭제
        </button>
      </div>

      <p className="ts-display-note">
        구독자에게는 일반 기간판매가와 멤버십 기간판매가 중 싼 값이 적용됩니다.
        멤버십 기간판매가가 일반 기간판매가보다 비싸면 구독자 혜택이 없으니
        멤버십 할인율을 충분히 잡으세요.
      </p>
      <div className="ts-table-scroll">
        <table className="ts-table ts-display-table">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  aria-label="전체 선택"
                  checked={allChecked}
                  onChange={() => setChecked(allChecked ? [] : [...productIds])}
                />
              </th>
              <th>진열순위</th>
              <th>
                상태
                <br />
                <small>(브라우저 표시)</small>
              </th>
              <th>상품번호</th>
              <th>상품코드</th>
              <th>상품명</th>
              <th>진열</th>
              <th>판매</th>
              <th>품절</th>
              <th>이미지</th>
              <th>상품상세</th>
              <th>소비자가</th>
              <th>
                기존
                <br />
                판매가
              </th>
              <th>
                기간
                <br />
                할인율
              </th>
              <th>
                기간
                <br />
                판매가
              </th>
              <th>
                멤버십
                <br />
                기간판매가
              </th>
            </tr>
          </thead>
          <tbody>
            {productIds.map((productId, index) => (
              <ProductRow
                key={productId}
                productId={productId}
                index={index}
                variants={rowsByProduct.get(productId) ?? EMPTY_ROWS}
                info={meta?.get(productId)}
                status={status}
                checked={checkedSet.has(productId)}
                hit={hit === productId}
                expanded={openSet.has(productId)}
                error={(rowsByProduct.get(productId) ?? EMPTY_ROWS)
                  .map((row) => errorByVariant.get(row.variantId))
                  .find(Boolean)}
                previousGeneral={previousGeneral}
                previousMembership={previousMembership}
                onToggleCheck={onToggleCheck}
                onToggleOpen={onToggleOpen}
                onVariant={onVariant}
                onProduct={onProduct}
              />
            ))}
          </tbody>
        </table>
      </div>
      {productIds.length === 0 && (
        <p className="ts-empty">
          진열한 상품이 없습니다. [상품 추가]로 담으세요.
        </p>
      )}
      {adding && <div ref={pickerRef}>{picker}</div>}
    </div>
  );
}
