import type { SupplierDto } from '@/lib/types/dto/inventory';
import type { SupplierQueueSummary } from '@/lib/types/dto/fulfillment';
import { directDeliverySuppliers } from '@/lib/utils/direct-delivery-suppliers';

export const DIRECT_SHIP_TABS = [
  'pending',
  'handoffs',
  'upload',
  'unfulfillable',
  'cancel-notices',
] as const;
export type DirectShipTab = (typeof DIRECT_SHIP_TABS)[number];

/** `?tab=` — 모르는 값, 그리고 권한 없이 연 «올리기»(탭이 안 보인다)는 대기로 */
export function resolveTab(
  requested: string | null,
  canUpload: boolean
): DirectShipTab {
  const known = (DIRECT_SHIP_TABS as readonly string[]).includes(
    requested ?? ''
  );
  if (!known) return 'pending';
  const tab = requested as DirectShipTab;
  return tab === 'upload' && !canUpload ? 'pending' : tab;
}

/** 요약 칩 — `이름 · 대기 n · 넘김 n · 못 보냄 n`, 0 인 수는 숨긴다 */
export function supplierChipLabel(s: SupplierQueueSummary): string {
  const parts = [s.supplierName];
  if (s.pendingShipments > 0) parts.push(`대기 ${s.pendingShipments}`);
  if (s.forwardedShipments > 0) parts.push(`넘김 ${s.forwardedShipments}`);
  if (s.unfulfillableLines > 0) parts.push(`못 보냄 ${s.unfulfillableLines}`);
  return parts.join(' · ');
}

const zeroChip = (
  supplierId: string,
  supplierName: string
): SupplierQueueSummary => ({
  supplierId,
  supplierCode: null,
  supplierName,
  pendingShipments: 0,
  forwardedShipments: 0,
  unfulfillableLines: 0,
});

export interface SupplierPickerView {
  chips: SupplierQueueSummary[];
  /** 화면이 쓸 입점사. null 이면 패널을 그리지 않는다 */
  selectedId: string | null;
  /** 고른 것이 없어 기본값을 정했다 — `?supplier=` 에 적어 둬야 요약이 바뀌어도 그 입점사에 머문다 */
  writeToUrl: boolean;
}

/**
 * 입점사 고르기. 칩 = 열린 상자 요약(그 순서 그대로, 앞에) + 열린 상자가 없는 직배 입점사(0 으로, 뒤에).
 * 요약은 열린 상자가 있는 입점사만 내므로 요약만으로 칩을 만들면 마지막 상자를 발송한 입점사가 사라진다 —
 * 그 입점사의 넘긴 것·올리기(송장 정정)로 갈 길이 없어진다.
 *
 * 기본값은 첫 칩이고 URL 에 적는다(`writeToUrl`). 적지 않으면 적용 뒤 요약이 바뀌는 순간 다른 입점사로 튄다.
 * 요약이 오기 전(`summariesReady=false`)에는 기본값을 정하지 않는다 — 직배 목록만 보고 고른 입점사가 URL 에 박힌다.
 * 고른 입점사가 칩에 없으면(목록 권한 없음 등) 짧은 id 칩을 더해 지금 무엇을 보고 있는지 보이게 한다.
 */
export function supplierPickerView(input: {
  summaries: SupplierQueueSummary[] | undefined;
  summariesReady: boolean;
  directSuppliers: readonly SupplierDto[] | undefined;
  requested: string | null;
}): SupplierPickerView {
  const summaries = input.summaries ?? [];
  const seen = new Set(summaries.map((s) => s.supplierId));
  const chips = [
    ...summaries,
    ...directDeliverySuppliers(input.directSuppliers)
      .filter((s) => !seen.has(s.id))
      .map((s) => zeroChip(s.id, s.name)),
  ];

  if (input.requested) {
    const known = chips.some((c) => c.supplierId === input.requested);
    return {
      chips: known
        ? chips
        : [
            ...chips,
            zeroChip(input.requested, `${input.requested.slice(0, 8)}…`),
          ],
      selectedId: input.requested,
      writeToUrl: false,
    };
  }
  if (!input.summariesReady)
    return { chips, selectedId: null, writeToUrl: false };
  const first = chips[0]?.supplierId ?? null;
  return { chips, selectedId: first, writeToUrl: first !== null };
}
