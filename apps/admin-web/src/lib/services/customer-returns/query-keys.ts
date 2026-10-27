import type { CustomerReturnListQuery } from '@/lib/types/dto/customer-returns';

/** 빈 값(undefined·빈 문자열) 칸을 뺀 목록 쿼리 — 같은 조건은 같은 키, undefined 는 키에 넣지 않는다 */
function normalize(q: CustomerReturnListQuery): Record<string, string | number> {
  const out: Record<string, string | number> = { bucket: q.bucket };
  const needle = q.q?.trim();
  if (needle) out.q = needle;
  if (q.limit !== undefined) out.limit = q.limit;
  if (q.offset !== undefined) out.offset = q.offset;
  return out;
}

export const customerReturnQueryKeys = {
  all: ['customer-returns'] as const,
  list: (q: CustomerReturnListQuery) => [...customerReturnQueryKeys.all, 'list', normalize(q)] as const,
  detail: (id: string) => [...customerReturnQueryKeys.all, 'detail', id] as const,
  preview: (orderId: string, returnId: string) =>
    [...customerReturnQueryKeys.all, 'preview', orderId, returnId] as const,
  returnable: (orderId: string) => [...customerReturnQueryKeys.all, 'returnable', orderId] as const,
} as const;
