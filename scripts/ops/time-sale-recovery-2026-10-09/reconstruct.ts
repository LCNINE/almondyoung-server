/**
 * 2026-10-09 타임세일 사고 복구 — 백업 JSON 에서 세일별 «마지막으로 의도한 가격» 을 되살린다.
 *
 * 백업은 사고 당일 라이브 Medusa 에서 뜬 sale price list 19개·가격 16,407행이다(삭제된 행 포함).
 * 수정이 가격을 «교체» 하지 못하고 «덧붙여» 한 리스트에 같은 품목의 가격이 여러 벌 있다. 실측으로
 * 모든 벌의 금액이 같았지만, 다르면 어느 게 의도인지 알 수 없으므로 멈춘다.
 *
 * 예외: 정상 교체로 지워진 옛 행(삭제 분 ≤ 최신 저장 묶음의 분)은 대조에서 뺀다 — 노몬드 5000→6000 같은 수정이
 * 그렇다. 최신 묶음 이후에도 살아 있던 행끼리는 여전히 금액이 같아야 한다.
 */

export type BackupList = { id: string; title: string; starts_at: string | null; ends_at: string | null; created_at: string };
export type BackupRule = { price_list_id: string; attribute: string };
export type BackupPrice = {
  id: string;
  price_list_id: string;
  variant_id: string | null;
  amount: string | number;
  created_at: string;
  deleted_at: string | null;
};
export type BackupFile = { exportedAt: string; lists: BackupList[]; rules: BackupRule[]; prices: BackupPrice[] };

export type RecoveryTarget = {
  name: string;
  generalListId: string;
  membershipListIds: string[];
  status: 'draft' | 'active';
  startsAt: string;
  endsAt: string;
};

type PriceInput = { variant_id: string; amount: number };

export type RecoveryPlanEntry = {
  name: string;
  generalListId: string;
  membershipListIds: string[];
  body: {
    title: string;
    starts_at: string;
    ends_at: string;
    status: 'draft' | 'active';
    general_prices: PriceInput[];
    membership_prices: PriceInput[];
  };
  summary: { generalCount: number; generalSum: number; membershipCount: number; membershipSum: number };
};

/** ISO 시각 → 분 단위 정수. 문자열 비교 대신 시각으로 파싱해, 형식(공백·오프셋)이 달라도 순서가 틀리지 않게 한다. */
const minute = (iso: string) => Math.floor(Date.parse(iso) / 60000);

/** 한 리스트의 가격들 → variant → 금액. 가장 늦은 저장 묶음(같은 분)의 값을 쓰고, 묶음끼리 다르면 던진다. */
export function latestBatch(prices: BackupPrice[]): Map<string, number> {
  if (prices.length === 0) return new Map();
  const last = Math.max(...prices.map((p) => minute(p.created_at)));

  // 최신 묶음이 써진 분 이전(또는 같은 분)에 지워진 행은 정상 교체로 밀려난 옛 행이다 — 대조에서 뺀다.
  const superseded = (p: BackupPrice) => p.deleted_at !== null && minute(p.deleted_at) <= last;

  const seen = new Map<string, number>();
  for (const p of prices) {
    if (!p.variant_id || superseded(p)) continue;
    const amount = Number(p.amount);
    const prev = seen.get(p.variant_id);
    if (prev !== undefined && prev !== amount) {
      throw new Error(`저장 묶음끼리 금액이 다릅니다: ${p.variant_id} (${prev} vs ${amount})`);
    }
    seen.set(p.variant_id, amount);
  }

  const map = new Map<string, number>();
  for (const p of [...prices].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))) {
    if (p.variant_id && minute(p.created_at) === last) map.set(p.variant_id, Number(p.amount));
  }
  return map;
}

const pricesOf = (backup: BackupFile, listId: string) => {
  const rows = backup.prices.filter((p) => p.price_list_id === listId);
  if (rows.length === 0) throw new Error(`백업에 가격이 없는 리스트: ${listId}`);
  return latestBatch(rows);
};

const toInputs = (map: Map<string, number>): PriceInput[] =>
  [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([variant_id, amount]) => ({ variant_id, amount }));

const sum = (inputs: PriceInput[]) => inputs.reduce((total, p) => total + p.amount, 0);

/** 라이브 `GET /admin/time-sales` 의 한 세일(관리자 DTO 의 필요한 부분). */
export type ReplacementSale = {
  status: string;
  generalPrices: Record<string, number>;
  membershipPrices: Record<string, number>;
};

/**
 * 옛 리스트를 지우기 전에, 대체 세일이 계획과 맞게 살아 있는지 본다. 빈 배열이면 맞다.
 * 제목만으로는 같은 이름의 엉뚱한 세일을 집을 수 있으므로 상태·개수·합계·품목별 금액을 모두 대조한다.
 */
export function replacementMismatches(entry: RecoveryPlanEntry, sale: ReplacementSale): string[] {
  const reasons: string[] = [];
  if (sale.status !== entry.body.status) reasons.push(`상태 ${sale.status} ≠ ${entry.body.status}`);

  const side = (
    label: string,
    expected: PriceInput[],
    actual: Record<string, number>,
    count: number,
    total: number,
  ) => {
    const actualCount = Object.keys(actual).length;
    const actualSum = Object.values(actual).reduce((s, n) => s + n, 0);
    if (actualCount !== count) reasons.push(`${label} 개수 ${actualCount} ≠ ${count}`);
    if (actualSum !== total) reasons.push(`${label} 합계 ${actualSum} ≠ ${total}`);
    const want = new Map(expected.map((p) => [p.variant_id, p.amount]));
    const differing = new Set([...want.keys(), ...Object.keys(actual)]);
    const mismatched = [...differing].filter((v) => want.get(v) !== actual[v]).length;
    if (mismatched > 0) reasons.push(`${label} 품목별 금액 불일치 ${mismatched}건`);
  };
  side('일반', entry.body.general_prices, sale.generalPrices, entry.summary.generalCount, entry.summary.generalSum);
  side('멤버십', entry.body.membership_prices, sale.membershipPrices, entry.summary.membershipCount, entry.summary.membershipSum);
  return reasons;
}

export function reconstruct(backup: BackupFile, targets: RecoveryTarget[]): RecoveryPlanEntry[] {
  return targets.map((target) => {
    const general = pricesOf(backup, target.generalListId);

    // 멤버십 리스트가 둘 붙은 세일(수정 중 새로 생긴 것)은 두 리스트를 합친다 — 같은 품목이 다르면 던진다.
    const membership = new Map<string, number>();
    for (const listId of target.membershipListIds) {
      for (const [variant, amount] of pricesOf(backup, listId)) {
        const prev = membership.get(variant);
        if (prev !== undefined && prev !== amount) {
          throw new Error(`멤버십 리스트끼리 금액이 다릅니다: ${variant} (${prev} vs ${amount})`);
        }
        membership.set(variant, amount);
      }
    }
    // 일반 세일가 없는 멤버십 품목은 서버가 거절한다 — 미리 걸러 원인을 여기서 드러낸다.
    const orphan = [...membership.keys()].filter((v) => !general.has(v));
    if (orphan.length > 0) throw new Error(`${target.name}: 일반 세일가 없는 멤버십 품목 ${orphan.length}개`);

    const generalPrices = toInputs(general);
    const membershipPrices = toInputs(membership);
    return {
      name: target.name,
      generalListId: target.generalListId,
      membershipListIds: target.membershipListIds,
      body: {
        title: target.name,
        starts_at: target.startsAt,
        ends_at: target.endsAt,
        status: target.status,
        general_prices: generalPrices,
        membership_prices: membershipPrices,
      },
      summary: {
        generalCount: generalPrices.length,
        generalSum: sum(generalPrices),
        membershipCount: membershipPrices.length,
        membershipSum: sum(membershipPrices),
      },
    };
  });
}
