import { z } from 'zod';
import type { PrintComboDto, PrintKind, PrintOptionsDto } from '@/lib/types/dto/print-catalog';
import { PRINT_KINDS } from '@/lib/types/dto/print-catalog';

export const COMBO_LIMIT = 200;
export const TIMES_CHOICES = [2, 2.5, 3] as const;
export const DISCOUNT_CHOICES = [0, 5, 10] as const;
export type DiscountPct = (typeof DISCOUNT_CHOICES)[number];

export interface PickedAxes {
  papers: number[];
  colors: number[];
  qtys: number[];
}

export interface PublishRow {
  key: string;
  cost: number | null;
  price: number;
  memberPrice: number | null;
  on: boolean;
}

export function isPrintKind(kind: string | null): kind is PrintKind {
  return PRINT_KINDS.some((k) => k === kind);
}

export function parseTemplateSize(size: string): { width: number; height: number } {
  const match = /^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/.exec(size.trim());
  if (!match) return { width: 0, height: 0 };

  return { width: Number(match[1]), height: Number(match[2]) };
}

export const comboKey = (paperno: number, colorno: number, qty: number): string => `${paperno}-${colorno}-${qty}`;

export function combos(
  picked: PickedAxes,
  awk: number[] = [],
  allows: (paperno: number, colorno: number, qty: number) => boolean = () => true
): PrintComboDto[] {
  const out: PrintComboDto[] = [];
  for (const paperno of picked.papers) {
    for (const colorno of picked.colors) {
      for (const qty of picked.qtys) {
        if (!allows(paperno, colorno, qty)) continue;

        out.push({ key: comboKey(paperno, colorno, qty), paperno, colorno, qty, awk: [...awk] });
      }
    }
  }

  return out;
}

// 조건 키(paperno:1|colorno:2, all)가 고른 용지·면과 맞는 수량 목록에 그 수량이 있는지
export function qtyAllowed(
  quantities: PrintOptionsDto['quantities'],
  paperno: number,
  colorno: number,
  qty: number
): boolean {
  if (quantities.length === 0) return true;

  const fits = quantities.filter((q) => {
    if (q.key === 'all') return true;

    return q.key.split('|').every((part) => {
      const [name, value] = part.split(':');
      if (name === 'paperno') return Number(value) === paperno;
      if (name === 'colorno') return Number(value) === colorno;

      return true;
    });
  });

  return fits.some((q) => q.values.includes(qty));
}

export function qtyChoices(quantities: PrintOptionsDto['quantities']): number[] {
  return [...new Set(quantities.flatMap((q) => q.values))].sort((a, b) => a - b);
}

export function defaultAwk(
  requiredAwk: PrintOptionsDto['requiredAwk'],
  forbiddenAwk: PrintOptionsDto['forbiddenAwk']
): number[] {
  const forbidden = new Set(forbiddenAwk.map((f) => f.jobno));
  const out: number[] = [];
  for (const group of requiredAwk) {
    const pick = forbidden.has(group.defaultJobno)
      ? group.options.find((o) => !forbidden.has(o.jobno))?.jobno
      : group.defaultJobno;
    if (pick !== undefined) out.push(pick);
  }

  return out;
}

export function priceFor(cost: number, times: number): number {
  const raw = Math.round(cost * times * 1000) / 1000;

  return Math.ceil(raw / 100) * 100;
}

export function memberPriceFor(price: number, discountPct: DiscountPct): number {
  if (discountPct === 0) return price;

  return Math.floor((price * (100 - discountPct)) / 10000) * 100;
}

export function applyTimes(
  prices: Record<string, number>,
  edited: Set<string>,
  costs: Record<string, number>,
  times: number
): Record<string, number> {
  const next: Record<string, number> = { ...prices };
  for (const [key, cost] of Object.entries(costs)) {
    if (edited.has(key) && prices[key] !== undefined) continue;

    next[key] = priceFor(cost, times);
  }

  return next;
}

export function blockers(rows: PublishRow[], bleedMatches: boolean): string[] {
  const out: string[] = [];
  if (!bleedMatches) out.push('편집기 재단 여유가 와우프레스 작업 크기와 달라서 게시할 수 없어요');

  const on = rows.filter((r) => r.on);
  if (on.length === 0) {
    out.push('판매할 조합이 없어요');

    return out;
  }

  if (on.length > COMBO_LIMIT) out.push(`조합은 ${COMBO_LIMIT}개까지 만들 수 있어요`);

  const failed = on.filter((r) => r.cost === null).length;
  if (failed > 0) out.push(`견적을 불러오지 못한 조합이 ${failed}개 있어요`);

  const cheap = on.filter((r) => r.cost !== null && r.price <= r.cost).length;
  if (cheap > 0) out.push(`판매가가 원가보다 싸거나 같은 조합이 ${cheap}개 있어요`);

  const cheapMember = on.filter((r) => r.cost !== null && r.memberPrice !== null && r.memberPrice <= r.cost).length;
  if (cheapMember > 0) out.push(`멤버십가가 원가보다 싸거나 같은 조합이 ${cheapMember}개 있어요`);

  return out;
}

const draftSchema = z.object({
  step: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  name: z.string(),
  description: z.string(),
  picked: z.object({ papers: z.array(z.number()), colors: z.array(z.number()), qtys: z.array(z.number()) }),
  times: z.number().min(1),
  discountPct: z.union([z.literal(0), z.literal(5), z.literal(10)]),
  edited: z.record(z.string(), z.number()),
  off: z.array(z.string()),
});

export type PublishDraft = z.infer<typeof draftSchema>;

export const draftKey = (templateId: string): string => `almond-publish-draft:${templateId}`;

export function loadDraft(templateId: string): PublishDraft | null {
  try {
    const raw = window.localStorage.getItem(draftKey(templateId));
    if (!raw) return null;

    const parsed = draftSchema.safeParse(JSON.parse(raw));

    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function saveDraft(templateId: string, draft: PublishDraft): void {
  try {
    window.localStorage.setItem(draftKey(templateId), JSON.stringify(draft));
  } catch {
    // 저장소를 못 쓰면 임시 저장만 건너뛴다
  }
}

export function clearDraft(templateId: string): void {
  try {
    window.localStorage.removeItem(draftKey(templateId));
  } catch {
    // 저장소를 못 쓰면 지울 것도 없다
  }
}

export function qtyLabel(kind: PrintKind, qty: number): string {
  const unit = kind === 'card' || kind === 'bizcard' || kind === 'nail' ? '매' : '개';

  return `${qty.toLocaleString('ko-KR')}${unit}`;
}

export const won = (n: number): string => `${n.toLocaleString('ko-KR')}원`;
