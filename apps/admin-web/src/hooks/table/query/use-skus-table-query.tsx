import { useQueryParams } from '../../use-query-params';
import type { SkuQuery } from '@/lib/types/dto/inventory';

type UseSkusTableQueryProps = {
  pageSize?: number;
};

export const useSkusTableQuery = ({ pageSize = 20 }: UseSkusTableQueryProps = {}) => {
  const raw = useQueryParams(['page', 'code', 'name', 'barcode', 'groupId', 'supplierName']);

  const { page, code, name, barcode, groupId, supplierName } = raw;

  const searchParams: SkuQuery = {
    limit: pageSize,
    offset: page ? (Number(page) - 1) * pageSize : 0,
    code: code || undefined,
    name: name || undefined,
    barcode: barcode || undefined,
    groupId: groupId || undefined,
    supplierName: supplierName || undefined,
  };

  return { searchParams, raw };
};
