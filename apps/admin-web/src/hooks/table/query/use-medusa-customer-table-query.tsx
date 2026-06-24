import type { MedusaCustomerListQuery } from '@/lib/types/dto/medusa';
import { useQueryParams } from '../../use-query-params';

type UseMedusaCustomerTableQueryProps = {
  prefix?: string;
  pageSize?: number;
};

export const useMedusaCustomerTableQuery = ({
  prefix,
  pageSize = 20,
}: UseMedusaCustomerTableQueryProps) => {
  const queryObject = useQueryParams(['page', 'q', 'sort', 'order'], prefix);

  const { page, q, sort, order } = queryObject;

  const offset = page ? (Number(page) - 1) * pageSize : 0;

  // Medusa 형식: desc는 "-field", asc는 "field"
  // 기본값: 가입일 내림차순
  const sortField = sort ?? 'created_at';
  const sortDir = order ?? 'desc';
  const orderParam = sortDir === 'desc' ? `-${sortField}` : sortField;

  const searchParams: MedusaCustomerListQuery = {
    limit: pageSize,
    offset,
    q,
    order: orderParam,
  };

  return { searchParams, raw: queryObject };
};
