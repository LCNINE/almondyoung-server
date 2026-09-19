import { BusinessLicenseListQuery, BusinessLicenseStatus } from '@/lib/types/dto/business-licenses';
import { useQueryParams } from '../../use-query-params';
import { parseDateRangeParam } from './date-range-param';

type UseBusinessLicenseTableQueryProps = {
  prefix?: string;
  pageSize?: number;
};

export const useBusinessLicenseTableQuery = ({
  prefix,
  pageSize = 20,
}: UseBusinessLicenseTableQueryProps) => {
  const queryObject = useQueryParams(
    ['page', 'status', 'hasVerificationFile', 'sort', 'order', 'createdAt'],
    prefix
  );

  const { page, status, hasVerificationFile, sort, order, createdAt } = queryObject;
  const { from: createdFrom, to: createdTo } = parseDateRangeParam(createdAt);

  const searchParams: BusinessLicenseListQuery = {
    limit: pageSize,
    page: page ? Number(page) : 1,
    status: status as BusinessLicenseStatus | undefined,
    hasVerificationFile:
      hasVerificationFile === 'true'
        ? true
        : hasVerificationFile === 'false'
          ? false
          : undefined,
    sort,
    order: order as BusinessLicenseListQuery['order'],
    createdFrom,
    createdTo,
  };

  return { searchParams, raw: queryObject };
};
