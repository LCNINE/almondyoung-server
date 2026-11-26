import { Link } from '@tanstack/react-router';
import { ScanBarcode } from 'lucide-react';
import {
  useWorkCapabilities,
  assertInboundWorkflowCapability,
} from '../../core/operations/useWorkCapabilities';
import { useWorkRuntime } from '../../core/operations/OperationContext';
import { WorkArea } from '../../core/operations/WorkBoundary';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useWarehouse } from '../../app/warehouse-context';
import { ApiError } from '../../core/data/httpClient';
import { errorMessage } from '../../core/data/errorMessage';
import { Button } from '../../core/design/Button';
import { ScreenHeader } from '../../core/design/ScreenHeader';
import { QuantityInput, parseQuantity } from '../../core/design/QuantityInput';
import { NumberPad } from '../../core/design/NumberPad';
import { ConfirmDialog } from '../../core/design/ConfirmDialog';
import { cn } from '../../core/design/cn';
import { useScanner } from '../../core/hardware/scan/useScanner';
import { useLocationSearch } from '../warehouse/useLocationSearch';
import { WarehousePicker } from '../warehouse/WarehousePicker';
import { useLocationContents } from './useLocationContents';
import { useMoveStock, MOVE_REASONS } from './useMoveStock';
import type { LocationContentItem } from './types';
import { workSummary } from '../../core/operations/pendingWork';
import type { LocationItem } from '../warehouse/types';

const OTHER = '기타';

const DESCRIPTION = '출발 위치의 상품을 다른 로케이션으로 옮깁니다.';

const PANEL =
  'flex min-w-0 flex-col overflow-hidden rounded-xl border border-[#e4e4e7] bg-white';

const PANEL_HEAD =
  'flex min-h-[66px] shrink-0 items-center justify-between gap-2.5 border-b border-[#e4e4e7] px-[22px] py-[19px] max-[700px]:min-h-16';

const SMALL_BUTTON =
  'inline-flex items-center justify-center whitespace-nowrap rounded-lg border border-[#e4e4e7] bg-white px-2.5 py-[7px] text-xs font-semibold text-[#27272a] hover:bg-[#eff6ff] disabled:pointer-events-none disabled:opacity-40';

type LocationRef = Pick<LocationItem, 'id' | 'code' | 'isActive' | 'isSystem'>;

interface MovementRecord {
  key: string;
  skuName: string;
  qty: number;
  from: string;
  to: string;
  time: string;
}

function isMovementDestination(
  location: Pick<LocationItem, 'isActive' | 'isSystem'>
) {
  return location.isActive === true && typeof location.isSystem === 'boolean';
}

function toRef(location: LocationItem): LocationRef {
  return {
    id: location.id,
    code: location.code,
    isActive: location.isActive,
    isSystem: location.isSystem,
  };
}

function clockLabel(at: Date) {
  return at.toLocaleTimeString('ko-KR', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function MovementScreenContent() {
  const { warehouseId, warehouseName, isSet } = useWarehouse();
  // Invalidate captured preflight intent synchronously, before React renders an edit.
  const intentRevision = useRef(0);

  // (a) 출발지
  const [source, setSource] = useState<LocationRef | null>(null);
  const [sourceTerm, setSourceTerm] = useState('');
  // (c) 품목 이동 시트
  const [activeItem, setActiveItem] = useState<LocationContentItem | null>(
    null
  );
  const [dest, setDestValue] = useState<LocationRef | null>(null);
  const [destTerm, setDestTermValue] = useState('');
  const [destOpen, setDestOpen] = useState(false);
  const [destNotice, setDestNotice] = useState<string | null>(null);
  const [quantityText, setQuantityTextValue] = useState(String(0));
  const qty = parseQuantity(quantityText, 1) ?? 0;
  const setQty = (next: number) => setQuantityText(String(next));
  const [reason, setReasonValue] = useState<string | null>(null);
  const [otherReason, setOtherReasonValue] = useState('');
  const setDest = useCallback((next: LocationRef | null) => {
    intentRevision.current += 1;
    setDestValue(next);
    setDestNotice(null);
  }, []);
  const setDestTerm = useCallback((next: string) => {
    setDestTermValue(next);
    setDestNotice(null);
  }, []);
  const setQuantityText = useCallback((next: string) => {
    intentRevision.current += 1;
    setQuantityTextValue(next);
  }, []);
  const setReason = useCallback((next: string | null) => {
    intentRevision.current += 1;
    setReasonValue(next);
  }, []);
  const setOtherReason = useCallback((next: string) => {
    intentRevision.current += 1;
    setOtherReasonValue(next);
  }, []);
  const [lastDest, setLastDest] = useState<LocationRef | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    crypto.randomUUID()
  );
  const [history, setHistory] = useState<MovementRecord[]>([]);

  const runtime = useWorkRuntime();
  const capabilities = useWorkCapabilities();
  const supported =
    !!runtime &&
    capabilities.isSuccess &&
    capabilities.data.inboundWorkflowConsistency === true;
  const [actionError, setActionError] = useState<string | null>(null);
  const actionLock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const contents = useLocationContents(source?.id);
  const sourceSearch = useLocationSearch(
    warehouseId,
    source ? '' : sourceTerm,
    'movement-source',
    { listWhenEmpty: !source }
  );
  const destSearch = useLocationSearch(
    warehouseId,
    !activeItem || dest ? '' : destTerm,
    'movement-destination',
    { listWhenEmpty: Boolean(activeItem) && !dest && destOpen }
  );
  const move = useMoveStock();

  // 스캔은 모드에 따라 라우팅된다: 시트가 열려 있고 대상지 미정이면 대상지로,
  // 아니면 출발지 대기 중일 때 출발지로. 내용물 모드(출발지 선택됨·시트 닫힘)의
  // 스캔은 무시한다 — 품목은 탭으로 고른다.
  useScanner((e) => {
    if (activeItem) {
      if (!dest) {
        setDestTerm(e.code);
        setDestOpen(true);
      }

      return;
    }
    if (!source) setSourceTerm(e.code);
  });

  const sourceOptions = sourceSearch.data?.items ?? [];
  const destOptions = (destSearch.data?.items ?? [])
    .filter((i) => i.id !== source?.id)
    .filter(isMovementDestination);

  function chooseSource(location: LocationItem) {
    setSource(toRef(location));
    setSourceTerm('');
  }

  function chooseDest(location: LocationItem) {
    setDest(toRef(location));
    setDestTerm('');
    setDestOpen(false);
  }

  // 출발지: 스캔/입력이 코드와 정확히 일치하는 단건이면 자동 선택.
  useEffect(() => {
    if (source) return;
    const term = sourceTerm.trim();
    if (!term) return;
    const exact = (sourceSearch.data?.items ?? []).filter(
      (i) => i.code === term
    );
    if (exact.length === 1) {
      setSource(toRef(exact[0]));
      setSourceTerm('');
    }
  }, [sourceSearch.data, sourceTerm, source]);

  // 대상지: 출발지를 제외한 뒤 코드 완전일치 단건이면 자동 선택.
  useEffect(() => {
    if (!activeItem || dest) return;
    const term = destTerm.trim();
    if (!term) return;
    const exact = (destSearch.data?.items ?? [])
      .filter((i) => i.id !== source?.id)
      .filter(isMovementDestination)
      .filter((i) => i.code === term);
    if (exact.length === 1) {
      setDest(toRef(exact[0]));
      setDestTerm('');
      setDestOpen(false);
    }
  }, [
    destSearch.data,
    destTerm,
    activeItem,
    dest,
    source,
    setDest,
    setDestTerm,
  ]);

  // 멱등키 회전: payload(품목·출발·대상·수량)가 바뀌면 새 키를 발급한다.
  // "요청은 커밋됐는데 응답만 유실" 뒤 값을 고쳐 재제출하면 옛 payload 를
  // 같은 키로 replay 하는 사고를 막는다. 값이 안 바뀐 재시도는 같은 키를 유지.
  const keyPayloadRef = useRef({ skuId: '', from: '', to: '', qty: 0 });
  useEffect(() => {
    if (!activeItem || !source) return;
    const next = {
      skuId: activeItem.skuId,
      from: source.id,
      to: dest?.id ?? '',
      qty,
    };
    const prev = keyPayloadRef.current;
    if (
      prev.skuId === next.skuId &&
      prev.from === next.from &&
      prev.to === next.to &&
      prev.qty === next.qty
    ) {
      return;
    }
    keyPayloadRef.current = next;
    setIdempotencyKey(crypto.randomUUID());
  }, [activeItem, source, dest, qty]);

  function openSheet(item: LocationContentItem) {
    if (!source || !supported || !(item.generallyMovableQty > 0)) return;
    intentRevision.current += 1;
    setActiveItem(item);
    setDest(null);
    setDestTerm('');
    setDestOpen(false);
    setQty(item.generallyMovableQty);
    setReason(null);
    setOtherReason('');
    keyPayloadRef.current = {
      skuId: item.skuId,
      from: source.id,
      to: '',
      qty: item.generallyMovableQty,
    };
    setIdempotencyKey(crypto.randomUUID());
  }

  function closeSheet() {
    intentRevision.current += 1;
    setActiveItem(null);
    setDest(null);
    setDestTerm('');
    setDestOpen(false);
    setQty(0);
    setReason(null);
    setOtherReason('');
  }

  function submitSourceTerm() {
    const term = sourceTerm.trim();

    if (!term) return;

    const exact = sourceOptions.filter((i) => i.code === term);

    if (exact.length === 1) chooseSource(exact[0]);
  }

  function submitDestTerm() {
    const term = destTerm.trim();

    if (!term) return;

    if (term === source?.code) {
      setDestNotice('출발 위치와 다른 로케이션을 선택하세요.');
      return;
    }

    const exact = destOptions.filter((i) => i.code === term);

    if (exact.length === 1) {
      chooseDest(exact[0]);
      return;
    }

    if (!destSearch.isFetching) {
      setDestNotice('등록된 도착 로케이션을 선택하세요.');
    }
  }

  const movable = (contents.data?.items ?? []).filter(
    (i) => i.stockState === 'ON_HAND' && i.quantity > 0
  );
  const storedQty = movable.reduce((sum, item) => sum + item.quantity, 0);
  const effectiveReason =
    reason === OTHER ? otherReason.trim() : (reason ?? '');
  const canSubmit =
    supported &&
    Boolean(activeItem) &&
    Boolean(source) &&
    Boolean(dest) &&
    dest?.id !== source?.id &&
    qty >= 1 &&
    qty <= (activeItem?.generallyMovableQty ?? 0);
  const destListShown = !dest && destOpen;

  if (!isSet) {
    return (
      <div className="space-y-4">
        <ScreenHeader title="재고 이동" backTo="/" description={DESCRIPTION} />
        {!supported && (
          <p role="alert">앱과 서버 업데이트를 확인한 뒤 다시 시도해 주세요.</p>
        )}
        {actionError && <p role="alert">{actionError}</p>}
        <div className="space-y-3 rounded-xl border border-[#e4e4e7] bg-white p-5">
          <p className="text-[13px] text-[#71717a]">
            창고를 먼저 선택해 주세요.
          </p>
          <WarehousePicker />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-[22px] max-[700px]:space-y-[18px]">
      <ScreenHeader title="재고 이동" backTo="/" description={DESCRIPTION} />
      {!supported && (
        <p role="alert" className="text-[13px] text-[#aa4037]">
          앱과 서버 업데이트를 확인한 뒤 다시 시도해 주세요.
        </p>
      )}
      {actionError && (
        <p role="alert" className="text-[13px] text-[#aa4037]">
          {actionError}
        </p>
      )}

      <div className="grid shrink-0 grid-cols-[320px_minmax(0,1fr)] items-stretch gap-[22px] max-[1000px]:grid-cols-[260px_minmax(0,1fr)] max-[700px]:grid-cols-1 max-[700px]:gap-[18px]">
        <section aria-label="출발 로케이션" className={PANEL}>
          <div className={PANEL_HEAD}>
            <h3 className="text-base font-semibold text-[#27272a]">
              출발 로케이션
            </h3>
            {source ? (
              <button
                type="button"
                className="inline-flex items-center py-[7px] text-xs text-[#2563eb]"
                onClick={() => {
                  setSource(null);
                  closeSheet();
                }}
              >
                변경
              </button>
            ) : null}
          </div>
          {source ? (
            <div className="flex flex-1 flex-col items-start p-[25px] max-[700px]:p-5">
              <strong className="text-[26px] font-bold tracking-[-0.6px] text-[#27272a]">
                {source.code}
              </strong>
              <p className="my-3 text-[13px] text-[#52525b]">
                {contents.isLoading
                  ? '불러오는 중…'
                  : `${movable.length}종 · ${storedQty}개 보관 중`}
              </p>
              <small className="mt-auto block pt-4 text-xs leading-[1.7] text-[#71717a]">
                이 위치에서 꺼낼 상품을 선택하세요.
              </small>
            </div>
          ) : (
            <div className="px-[22px] py-5">
              <form
                className="flex items-center gap-1.5 rounded-[10px] border border-[#e4e4e7] bg-white p-[9px]"
                onSubmit={(e) => {
                  e.preventDefault();
                  submitSourceTerm();
                }}
              >
                <ScanBarcode
                  className="h-[17px] w-[17px] shrink-0 text-[#2563eb]"
                  aria-hidden
                />
                <input
                  id="src-search"
                  aria-label="출발 로케이션 검색"
                  className="w-full flex-1 border-0 bg-transparent p-1 text-xs outline-0"
                  placeholder="바코드 스캔 또는 위치 코드"
                  autoComplete="off"
                  value={sourceTerm}
                  onChange={(e) => setSourceTerm(e.target.value)}
                />
              </form>
              <p className="mt-[9px] text-[11px] leading-[1.7] text-[#71717a]">
                코드 입력 후 Enter · 정확히 일치하면 바로 선택
              </p>
              {sourceSearch.isError ? (
                <p
                  role="alert"
                  className="mt-[13px] text-xs leading-[1.7] text-[#b42318]"
                >
                  {errorMessage(sourceSearch.error, 'location')}
                </p>
              ) : null}
              <div className="mt-[17px] flex max-h-[260px] flex-col overflow-auto border-t border-[#e4e4e7] max-[700px]:max-h-[200px]">
                {sourceOptions.map((loc) => (
                  <button
                    key={loc.id}
                    type="button"
                    className="flex items-center justify-between gap-3 border-b border-[#e4e4e7] px-1 py-3.5 text-left text-xs hover:bg-[#fafafa]"
                    onClick={() => chooseSource(loc)}
                  >
                    <strong className="font-[550] text-[#27272a]">
                      {loc.code}
                    </strong>
                    {loc.displayName && loc.displayName !== loc.code ? (
                      <span className="text-[11px] text-[#71717a]">
                        {loc.displayName}
                      </span>
                    ) : null}
                  </button>
                ))}
                {sourceSearch.isSuccess &&
                !sourceSearch.isFetching &&
                sourceOptions.length === 0 ? (
                  <p className="mt-[9px] text-[11px] leading-[1.7] text-[#71717a]">
                    일치하는 로케이션이 없습니다.
                  </p>
                ) : null}
              </div>
            </div>
          )}
        </section>

        <section aria-label="이동할 상품" className={PANEL}>
          <div className={PANEL_HEAD}>
            <h3 className="text-base font-semibold text-[#27272a]">
              이동할 상품
            </h3>
            <small className="text-xs text-[#71717a]">
              {source ? source.code : '출발 위치 선택 전'}
            </small>
          </div>
          {!source ? (
            <div className="grid flex-1 place-items-center px-6 py-[65px] text-center text-[13px] text-[#71717a] max-[700px]:px-[18px] max-[700px]:py-[35px]">
              출발 로케이션을 먼저 스캔하거나 선택하세요.
            </div>
          ) : contents.isError ? (
            <div className="grid flex-1 place-items-center px-6 py-[65px] text-center max-[700px]:px-[18px] max-[700px]:py-[35px]">
              <p role="alert" className="text-[13px] text-[#aa4037]">
                {errorMessage(contents.error, 'location')}
              </p>
            </div>
          ) : contents.isLoading ? (
            <div className="grid flex-1 place-items-center px-6 py-[65px] text-center text-[13px] text-[#71717a] max-[700px]:px-[18px] max-[700px]:py-[35px]">
              불러오는 중…
            </div>
          ) : movable.length === 0 ? (
            <div className="grid flex-1 place-items-center px-6 py-[65px] text-center text-[13px] text-[#71717a] max-[700px]:px-[18px] max-[700px]:py-[35px]">
              이 위치에 이동할 상품이 없습니다.
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm max-[700px]:min-w-[470px]">
                  <thead>
                    <tr className="bg-[#fafafa] text-left text-[11px] font-medium whitespace-nowrap text-[#71717a]">
                      <th className="px-5 py-3 font-medium max-[1000px]:p-3">
                        상품 / 옵션
                      </th>
                      <th className="px-5 py-3 text-right font-medium max-[1000px]:p-3">
                        현재
                      </th>
                      <th className="px-5 py-3 text-right font-medium max-[1000px]:p-3">
                        이동 가능
                      </th>
                      <th className="px-5 py-3 max-[1000px]:p-3">
                        <span className="sr-only">작업</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {movable.map((item) => (
                      <tr
                        key={`${item.skuId}-${item.stockState}`}
                        className="border-t border-[#e4e4e7]"
                      >
                        <td className="p-[18px] align-middle max-[1000px]:p-3">
                          <strong className="block text-sm leading-normal font-semibold text-[#27272a] max-[700px]:text-xs">
                            {item.skuName}
                          </strong>
                          <small className="mt-1 block font-mono text-[11px] text-[#71717a] max-[700px]:text-[10px]">
                            {item.skuCode}
                          </small>
                        </td>
                        <td className="p-[18px] text-right align-middle tabular-nums max-[1000px]:p-3">
                          {item.quantity}
                        </td>
                        <td className="p-[18px] text-right align-middle tabular-nums max-[1000px]:p-3">
                          <strong className="font-semibold">
                            {item.generallyMovableQty}
                          </strong>
                        </td>
                        <td className="p-[18px] align-middle max-[1000px]:p-3">
                          <div className="flex items-center justify-end gap-2">
                            {item.inboundPendingQty > 0 && (
                              <Link
                                to="/putaway"
                                className="text-xs whitespace-nowrap text-[#2563eb]"
                                search={{
                                  skuId: item.skuId,
                                  originLocationId: source.id,
                                }}
                              >
                                적치하기
                              </Link>
                            )}
                            <button
                              type="button"
                              aria-label={`${item.skuName} 이동`}
                              className={SMALL_BUTTON}
                              disabled={
                                !supported || !(item.generallyMovableQty > 0)
                              }
                              onClick={() => openSheet(item)}
                            >
                              이동
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-auto border-t border-[#e4e4e7] px-5 py-[17px] text-[11px] text-[#71717a]">
                출고 등에 예약된 수량은 이동 가능 수량에서 제외됩니다.
              </p>
            </>
          )}
        </section>
      </div>

      {history.length > 0 ? (
        <section
          aria-label="방금 이동한 내역"
          className={cn(PANEL, 'shrink-0')}
        >
          <div className="flex shrink-0 items-center justify-between gap-2.5 border-b border-[#e4e4e7] px-[22px] py-[19px]">
            <h3 className="text-base font-semibold text-[#27272a]">
              방금 이동한 내역
            </h3>
          </div>
          <ul aria-label="이동 내역">
            {history.map((record) => (
              <li
                key={record.key}
                className="flex shrink-0 items-center gap-6 border-t border-[#e4e4e7] p-[22px] first:border-t-0 max-[700px]:flex-wrap max-[700px]:gap-3 max-[700px]:p-[18px]"
              >
                <div className="min-w-[200px] flex-1">
                  <strong className="block text-sm leading-normal font-semibold text-[#27272a]">
                    {record.skuName} · {record.qty}개
                  </strong>
                  <small className="mt-1.5 block text-xs leading-normal text-[#71717a]">
                    {record.from} → {record.to}
                  </small>
                </div>
                <time className="shrink-0 text-xs text-[#71717a]">
                  {record.time}
                </time>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {activeItem && source ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-[#18181b55] p-4">
          <section
            role="dialog"
            aria-modal="true"
            aria-label="재고 이동"
            className="max-h-[90vh] w-full max-w-[440px] overflow-y-auto rounded-2xl border border-[#e4e4e7] bg-white p-7 text-[#27272a] shadow-[0_20px_80px_#18181b30] max-[700px]:p-[23px]"
          >
            <h2 className="mb-[22px] text-[22px] font-bold max-[700px]:text-xl">
              재고 이동
            </h2>
            <div>
              <strong className="block text-base font-semibold">
                {activeItem.skuName}
              </strong>
              <p className="mt-1.5 font-mono text-xs text-[#71717a]">
                {activeItem.skuCode}
              </p>
            </div>
            <dl className="mt-6 mb-[18px] flex flex-col gap-2.5">
              <div className="flex items-baseline text-[13px]">
                <dt className="w-[90px] shrink-0 text-[#71717a]">출발 위치</dt>
                <dd>{source.code}</dd>
              </div>
              <div className="flex items-baseline text-[13px]">
                <dt className="w-[90px] shrink-0 text-[#71717a]">이동 가능</dt>
                <dd className="tabular-nums">
                  {activeItem.generallyMovableQty}개
                  <span className="ml-2.5 text-[11px] text-[#71717a]">
                    현재 {activeItem.quantity}개
                  </span>
                </dd>
              </div>
            </dl>

            <div className="mt-[18px] space-y-2 text-[13px]">
              <QuantityInput
                label="이동 수량 직접 입력"
                value={quantityText}
                onChange={setQuantityText}
                min={1}
                max={activeItem.generallyMovableQty}
              />
              <NumberPad value={qty} onChange={setQty} />
              {qty > activeItem.generallyMovableQty ? (
                <p className="text-xs leading-[1.7] text-[#b42318]">
                  이동 가능 수량({activeItem.generallyMovableQty}개) 안에서
                  입력하세요.
                </p>
              ) : null}
            </div>

            <div className="mt-[18px] flex flex-col gap-2 text-[13px]">
              <span className="font-medium">도착 로케이션</span>
              {dest ? (
                <div className="flex items-center gap-3 rounded-lg border border-[#2563eb] bg-[#eff6ff] px-3.5 py-3">
                  <span className="flex-1 font-semibold">{dest.code}</span>
                  <button
                    type="button"
                    className="text-xs text-[#2563eb]"
                    onClick={() => setDest(null)}
                  >
                    변경
                  </button>
                </div>
              ) : (
                <>
                  {lastDest &&
                  lastDest.id !== source.id &&
                  isMovementDestination(lastDest) ? (
                    <button
                      type="button"
                      className="w-full rounded-lg border border-[#e4e4e7] bg-[#eff6ff] px-3.5 py-2.5 text-left text-[13px] text-[#2563eb]"
                      onClick={() => setDest(lastDest)}
                    >
                      직전 대상지 {lastDest.code} 사용
                    </button>
                  ) : null}
                  <div
                    className="flex flex-col gap-2"
                    onBlur={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget)) {
                        setDestOpen(false);
                      }
                    }}
                  >
                    <input
                      id="dest-search"
                      role="combobox"
                      aria-label="도착 로케이션"
                      aria-expanded={destListShown}
                      aria-controls="move-destination-options"
                      aria-autocomplete="list"
                      autoComplete="off"
                      className="w-full rounded-lg border border-[#e4e4e7] px-3.5 py-2.5 text-sm outline-none focus:border-[#2563eb]"
                      placeholder="위치 바코드 스캔 또는 코드 입력"
                      value={destTerm}
                      onFocus={() => setDestOpen(true)}
                      onClick={() => setDestOpen(true)}
                      onChange={(e) => {
                        setDestTerm(e.target.value);
                        setDestOpen(true);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.code === 'NumpadEnter') {
                          e.preventDefault();
                          submitDestTerm();
                          return;
                        }

                        if (e.key === 'Escape' && destOpen) {
                          e.stopPropagation();
                          setDestOpen(false);
                        }
                      }}
                    />
                    {destSearch.isError ? (
                      <p
                        role="alert"
                        className="text-xs leading-[1.7] text-[#b42318]"
                      >
                        {errorMessage(destSearch.error, 'location')}
                      </p>
                    ) : null}
                    {destListShown ? (
                      <div
                        id="move-destination-options"
                        role="group"
                        aria-label="도착 로케이션 목록"
                        className="max-h-[155px] overflow-y-auto rounded-lg border border-[#e4e4e7] [scrollbar-gutter:stable]"
                      >
                        {destOptions.map((loc) => (
                          <button
                            key={loc.id}
                            type="button"
                            className="flex w-full items-center justify-between border-b border-[#f4f4f5] px-3.5 py-3 text-left text-[13px] outline-0 hover:bg-[#f4f4f5] focus-visible:bg-[#f4f4f5]"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => chooseDest(loc)}
                          >
                            <strong className="font-semibold">
                              {loc.code}
                            </strong>
                            {loc.displayName && loc.displayName !== loc.code ? (
                              <span className="text-[11px] text-[#71717a]">
                                {loc.displayName}
                              </span>
                            ) : null}
                          </button>
                        ))}
                        {destOptions.length === 0 ? (
                          <p className="p-3.5 text-xs text-[#71717a]">
                            {destSearch.isFetching
                              ? '불러오는 중…'
                              : '일치하는 로케이션이 없습니다.'}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </>
              )}
              <p className="text-[11px] leading-[1.7] text-[#71717a]">
                {warehouseName ? `${warehouseName} · ` : ''}출발 위치를 제외한
                로케이션에서 선택하세요.
              </p>
              {destNotice ? (
                <p
                  role="alert"
                  className="text-xs leading-[1.7] text-[#b42318]"
                >
                  {destNotice}
                </p>
              ) : null}
            </div>

            <div className="mt-[18px] space-y-2 text-[13px]">
              <span className="block font-medium">
                사유{' '}
                <span className="text-[11px] font-normal text-[#71717a]">
                  (선택)
                </span>
              </span>
              <div className="flex flex-wrap gap-2">
                {MOVE_REASONS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setReason(reason === r ? null : r)}
                    className={cn(
                      'rounded-lg border px-3 py-1.5 text-[13px]',
                      reason === r
                        ? 'border-[#2563eb] bg-[#eff6ff] text-[#2563eb]'
                        : 'border-[#e4e4e7] bg-white text-[#27272a]'
                    )}
                  >
                    {r}
                  </button>
                ))}
              </div>
              {reason === OTHER ? (
                <input
                  aria-label="사유 직접 입력"
                  className="w-full rounded-lg border border-[#e4e4e7] px-3.5 py-2.5 text-sm outline-none focus:border-[#2563eb]"
                  placeholder="사유를 입력하세요"
                  value={otherReason}
                  onChange={(e) => setOtherReason(e.target.value)}
                />
              ) : null}
            </div>

            {move.isError ? (
              <p
                role="alert"
                className="mt-[13px] text-xs leading-[1.7] text-[#b42318]"
              >
                {errorMessage(move.error, 'movement')}
              </p>
            ) : null}

            <div className="mt-6 flex gap-2">
              <Button
                type="button"
                className="flex-1 border border-[#e4e4e7] bg-white py-[13px] text-[#27272a] hover:bg-[#eff6ff] hover:brightness-100"
                onClick={closeSheet}
              >
                돌아가기
              </Button>
              <Button
                type="button"
                className="flex-1 py-[13px]"
                disabled={!canSubmit || move.isPending}
                onClick={() => setConfirming(true)}
              >
                이동
              </Button>
            </div>
          </section>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirming}
        title="이동 확인"
        message={`${source?.code ?? ''} → ${dest?.code ?? ''}, ${activeItem?.skuName ?? '상품'} ${qty}개 이동합니다.`}
        confirmLabel="이동"
        onCancel={() => setConfirming(false)}
        onConfirm={async () => {
          setConfirming(false);
          if (
            !activeItem ||
            !source ||
            !dest ||
            !warehouseId ||
            !runtime ||
            !canSubmit ||
            actionLock.current
          )
            return;
          actionLock.current = true;
          const revision = intentRevision.current;
          try {
            await assertInboundWorkflowCapability(runtime);
            if (!mounted.current || revision !== intentRevision.current) return;
            const submitted = {
              key: idempotencyKey,
              skuName: activeItem.skuName,
              qty,
              from: source.code,
              to: dest.code,
            };
            const confirmedDest = dest;

            await move.mutateAsync({
              warehouseId,
              skuId: activeItem.skuId,
              fromLocationId: source.id,
              toLocationId: dest.id,
              quantity: qty,
              reason: effectiveReason || undefined,
              idempotencyKey,
              summary: workSummary([
                { name: activeItem.skuName, quantity: qty },
              ]),
            });

            if (!mounted.current) return;

            setHistory((list) =>
              list.some((row) => row.key === submitted.key)
                ? list
                : [{ ...submitted, time: clockLabel(new Date()) }, ...list]
            );
            setLastDest(confirmedDest);

            if (revision !== intentRevision.current) return;

            setIdempotencyKey(crypto.randomUUID());
            closeSheet();
          } catch (error) {
            if (mounted.current && revision === intentRevision.current) {
              if (
                error instanceof ApiError &&
                error.outcome === 'rejected' &&
                error.code === 'MOVEMENT_DESTINATION_INACTIVE'
              ) {
                setDest(null);
                setDestTerm('');
                setActionError(null);
              } else {
                setActionError(errorMessage(error, 'movement'));
              }
            }
          } finally {
            actionLock.current = false;
          }
        }}
      />
    </div>
  );
}

export function MovementScreen() {
  const { warehouseId } = useWarehouse();
  return (
    <WorkArea kind="movement">
      <MovementScreenContent key={warehouseId} />
    </WorkArea>
  );
}
