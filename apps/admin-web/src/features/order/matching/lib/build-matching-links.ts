import type { MatchingLinkInputDto } from '@/lib/types/dto/matching';

export type AutoTabOptionRow = {
  id: string;
  name: string;
  quantity: number;
};

export type AutoTabState = {
  holderId: string;
  supplierId: string;
  businessProductName: string;
  importDeclarationNumber: string;
  optionKey: string;
  productDescription: string;
  moq: string;
  memo2: string;
  memo3: string;
  optionRows: AutoTabOptionRow[];
};

export type BuildFailureReason = 'missing-required' | 'no-options';

export type BuildResult =
  | { ok: true; links: MatchingLinkInputDto[] }
  | { ok: false; reason: BuildFailureReason };

export const BUILD_FAILURE_MESSAGES: Record<BuildFailureReason, string> = {
  'missing-required': '공급처와 재고소유를 선택해주세요.',
  'no-options': '최소 1개 이상의 옵션명을 입력해주세요.',
};

export function normalizeQuantity(value: number): number {
  if (!Number.isFinite(value)) return 1;
  const truncated = Math.trunc(value);
  return truncated < 1 ? 1 : truncated;
}

/** 빈 문자열은 아예 보내지 않는다 — core 에서 '' 로 덮어쓰는 것을 막는다. */
function optionalText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function optionalPositiveInt(value: string): number | undefined {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * auto 탭 상태를 매칭 링크로 바꾼다. 옵션 행 하나가 새 재고상품 하나가 되고,
 * 그것들이 이 판매상품 variant 의 구성품으로 링크된다.
 */
export function buildMatchingLinks(state: AutoTabState): BuildResult {
  if (!state.supplierId || !state.holderId) {
    return { ok: false, reason: 'missing-required' };
  }

  const rows = state.optionRows.filter((row) => row.name.trim().length > 0);
  if (rows.length === 0) {
    return { ok: false, reason: 'no-options' };
  }

  const businessProductName = optionalText(state.businessProductName);
  const importDeclarationNumber = optionalText(state.importDeclarationNumber);
  const optionKey = optionalText(state.optionKey);
  const productDescription = optionalText(state.productDescription);
  const moq = optionalPositiveInt(state.moq);
  const memo2 = optionalText(state.memo2);
  const memo3 = optionalText(state.memo3);

  const links: MatchingLinkInputDto[] = rows.map((row) => ({
    quantity: normalizeQuantity(row.quantity),
    newSku: {
      name: row.name.trim(),
      holderId: state.holderId,
      supplierIds: [state.supplierId],
      ...(businessProductName !== undefined ? { businessProductName } : {}),
      ...(importDeclarationNumber !== undefined ? { importDeclarationNumber } : {}),
      ...(optionKey !== undefined ? { optionKey } : {}),
      ...(productDescription !== undefined ? { productDescription } : {}),
      ...(moq !== undefined ? { moq } : {}),
      ...(memo2 !== undefined ? { memo2 } : {}),
      ...(memo3 !== undefined ? { memo3 } : {}),
    },
  }));

  return { ok: true, links };
}
