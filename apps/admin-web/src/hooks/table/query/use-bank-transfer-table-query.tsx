import { useQueryParams } from '../../use-query-params';

type UseBankTransferTableQueryProps = {
  prefix?: string;
  pageSize?: number;
};

export const useBankTransferTableQuery = ({
  prefix,
  pageSize = 20,
}: UseBankTransferTableQueryProps) => {
  const queryObject = useQueryParams(['page'], prefix);

  const { page } = queryObject;

  return {
    page: page ? Number(page) : 1,
    limit: pageSize,
  };
};
