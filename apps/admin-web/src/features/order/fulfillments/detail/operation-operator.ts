import { useMemo } from 'react';
import { useCan } from '@/hooks/use-permission';
import { useAdminUsersByIds } from '@/lib/services/users/queries';
import { FULFILLMENT_SYSTEM_ACTOR_ID } from './operation-reasons';

/** 처리자 id → 이름. 자동 처리는 «자동». 이름을 모르거나 직원 목록을 볼 권한이 없으면 빈 문자열 */
export function useOperatorNames(
  ids: ReadonlyArray<string | null | undefined>
): (id: string | null | undefined) => string {
  const people = ids.filter(
    (id): id is string => !!id && id !== FULFILLMENT_SYSTEM_ACTOR_ID
  );
  const profile = useCan(['customer.profile.read']);
  const { data } = useAdminUsersByIds(people, {
    enabled: profile.status === 'ready' && profile.allowed,
    retry: false,
  });
  return useMemo(() => {
    const names = new Map(
      (data?.data ?? []).map((u) => [u.id, u.username || u.loginId])
    );
    return (id) => {
      if (!id) return '';
      if (id === FULFILLMENT_SYSTEM_ACTOR_ID) return '자동';
      return names.get(id) ?? '';
    };
  }, [data]);
}
