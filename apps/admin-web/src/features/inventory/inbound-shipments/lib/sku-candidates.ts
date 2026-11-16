import type { InboundShipmentLine } from '@/lib/types/dto/inbound-shipment';

export const SKU_CANDIDATE_LIMIT = 20;

export interface SkuCandidate {
  skuId: string;
  code: string;
  name: string;
  /** 후보가 위에 있는 이유. 검색 결과면 null. */
  hint: string | null;
}

interface SearchedSku {
  id: string;
  code: string;
  name: string;
}

/** 서버가 준 바코드 후보·AI 후보를 맨 위에, 그 아래 검색 결과. SKU id 로 중복 제거, 최대 20개. */
export function mergeSkuCandidates(line: InboundShipmentLine, searched: readonly SearchedSku[]): SkuCandidate[] {
  const byId = new Map<string, SkuCandidate>();
  const known = new Map(searched.map((s) => [s.id, s]));
  const add = (c: SkuCandidate) => {
    if (!byId.has(c.skuId)) byId.set(c.skuId, c);
  };
  for (const c of line.barcodeCandidates) {
    add({ skuId: c.skuId, code: c.code, name: c.name, hint: '바코드 일치' });
  }
  for (const c of line.aiCandidates ?? []) {
    const found = known.get(c.skuId);
    add({ skuId: c.skuId, code: c.code ?? found?.code ?? '', name: c.name ?? found?.name ?? '', hint: c.reason });
  }
  for (const s of searched) add({ skuId: s.id, code: s.code, name: s.name, hint: null });
  return [...byId.values()].slice(0, SKU_CANDIDATE_LIMIT);
}
