'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  deviceWorkClient,
  type DeviceWorkAction,
} from '../../api/domains/device-work';
import type { PermissionRequirement } from '@/lib/auth/mutation-permission';

export const deviceWorkQueryKeys = {
  all: ['device-work'] as const,
};

/** 기기가 10분마다 다시 올리므로 1분이면 충분하다. 운영 화면이라 캐시를 믿지 않는다 */
export const useDeviceWork = () =>
  useQuery({
    queryKey: deviceWorkQueryKeys.all,
    queryFn: deviceWorkClient.list,
    refetchInterval: 60_000,
    staleTime: 0,
    retry: false,
  });

/** 성공·실패와 무관하게 목록을 다시 읽는다 — 409 는 화면이 낡았다는 뜻이다 */
export function useResolveDeviceWork() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      operationKey,
      action,
    }: {
      operationKey: string;
      action: DeviceWorkAction;
    }) => deviceWorkClient.resolve(operationKey, action),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: deviceWorkQueryKeys.all }),
  });
}
useResolveDeviceWork.permission = [
  'inventory.device_work.resolve',
] as const satisfies PermissionRequirement;
