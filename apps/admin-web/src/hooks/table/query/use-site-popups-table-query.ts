import type {
  SitePopupAudience,
  SitePopupListQuery,
  SitePopupPlacement,
} from '@/lib/types/dto/products';
import { useQueryParams } from '../../use-query-params';

type UseSitePopupsTableQueryProps = {
  prefix?: string;
};

const parseBool = (value: string | undefined): boolean | undefined => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
};

export const useSitePopupsTableQuery = ({ prefix }: UseSitePopupsTableQueryProps = {}) => {
  const queryObject = useQueryParams(['isActive', 'placement', 'audience', 'q'], prefix);

  const { isActive, placement, audience, q } = queryObject;

  const searchParams: SitePopupListQuery = {
    includeInactive: true,
    isActive: parseBool(isActive),
    placement: (placement as SitePopupPlacement) || undefined,
    audience: (audience as SitePopupAudience) || undefined,
    q: q?.trim() || undefined,
  };

  return { searchParams, raw: queryObject };
};
