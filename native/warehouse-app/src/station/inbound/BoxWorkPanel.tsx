import { useEffect, useRef, type ReactNode } from 'react';
import { errorMessage } from '../../core/data/errorMessage';
import { SkuPicker, type SelectedSku } from '../../domains/inventory/SkuPicker';
import { BigPanel, type BigPanelContent } from '../outbound/panels';

const UNCERTAIN_MESSAGE = '결과를 확인하지 못했어요 — F10 다시 보내기';

/**
 * 상자 작업의 왼쪽 큰 칸 — 하나만 보인다(앞선 것이 이긴다):
 * 초안 읽는 중 · F9 SKU 검색 · 보내는 중 · 결과 모름 · 한 번 더 누르면 확정 · 안내 한 줄 · 지금 줄의 수량.
 */
export function BoxWorkPanel({
  loading,
  picking,
  onPick,
  busy,
  uncertain,
  armed,
  alert,
  quantity,
}: {
  /** 초안을 아직 못 열었다 — error 면 읽기 실패 */
  loading: { error: unknown } | null;
  picking: boolean;
  onPick(sku: SelectedSku): void;
  busy: boolean;
  uncertain: boolean;
  armed: boolean;
  alert: { message: string; detail?: string } | null;
  /** 지금 줄의 수량(빈칸이면 '') — 줄이 없으면 null */
  quantity: string | null;
}) {
  if (picking && !loading) {
    return (
      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-[#e4e4e7] bg-white p-3">
        <h3 className="mb-2 text-lg font-semibold">리스트에 없던 물건</h3>
        <AutoFocus>
          <SkuPicker onSelect={onPick} />
        </AutoFocus>
      </div>
    );
  }
  const content: BigPanelContent | null = loading
    ? loading.error
      ? { kind: 'alert', message: '저장된 작업을 읽지 못했어요', detail: errorMessage(loading.error) }
      : { kind: 'notice', title: '저장된 작업을 확인하고 있어요' }
    : busy
      ? { kind: 'notice', title: '확정하고 있어요' }
      : uncertain
        ? { kind: 'alert', message: UNCERTAIN_MESSAGE }
        : armed
          ? { kind: 'notice', title: '한 번 더 누르면 확정해요' }
          : alert
            ? { kind: 'alert', ...alert }
            : quantity !== null
              ? { kind: 'quantity', value: quantity }
              : null;
  return content ? <BigPanel content={content} /> : null;
}

/** 검색을 열면 입력칸에 바로 친다 */
function AutoFocus({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector('input')?.focus();
  }, []);
  return <div ref={ref}>{children}</div>;
}
