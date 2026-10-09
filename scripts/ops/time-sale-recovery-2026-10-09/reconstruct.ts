/**
 * 2026-10-09 타임세일 사고 복구 — 백업 JSON 에서 세일별 «마지막으로 의도한 가격» 을 되살린다.
 *
 * 백업은 사고 당일 라이브 Medusa 에서 뜬 sale price list 19개·가격 16,407행이다(삭제된 행 포함).
 * 수정이 가격을 «교체» 하지 못하고 «덧붙여» 한 리스트에 같은 품목의 가격이 여러 벌 있다. 실측으로
 * 모든 벌의 금액이 같았지만, 다르면 어느 게 의도인지 알 수 없으므로 멈춘다.
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

const minute = (iso: string) => iso.slice(0, 16);

/** 한 리스트의 가격들 → variant → 금액. 가장 늦은 저장 묶음(같은 분)의 값을 쓰고, 묶음끼리 다르면 던진다. */
export function latestBatch(prices: BackupPrice[]): Map<string, number> {
  const seen = new Map<string, number>();
  for (const p of prices) {
    if (!p.variant_id) continue;
    const amount = Number(p.amount);
    const prev = seen.get(p.variant_id);
    if (prev !== undefined && prev !== amount) {
      throw new Error(`저장 묶음끼리 금액이 다릅니다: ${p.variant_id} (${prev} vs ${amount})`);
    }
    seen.set(p.variant_id, amount);
  }
  if (prices.length === 0) return new Map();

  const last = prices.map((p) => minute(p.created_at)).sort().at(-1)!;
  const map = new Map<string, number>();
  for (const p of [...prices].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
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
