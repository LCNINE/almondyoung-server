import type { ChannelsQuery } from '@/lib/types/dto/products';
import { useQueryParams } from '../../use-query-params';

type UseSalesChannelTableQueryProps = {
  pageSize?: number;
};

export const useSalesChannelTableQuery = ({
  pageSize = 20,
}: UseSalesChannelTableQueryProps = {}) => {
  const queryObject = useQueryParams(['page', 'site', 'search']);

  const { page, site, search } = queryObject;

  const searchParams: ChannelsQuery = {
    limit: pageSize,
    page: page ? Number(page) : 1,
    site: site || undefined,
    search: search || undefined,
  };

  return { searchParams, raw: queryObject };
};
