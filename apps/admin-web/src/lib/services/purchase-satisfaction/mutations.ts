'use client';

import { purchaseSatisfactionApi } from '@/lib/api/domains/purchase-satisfaction';
import type { PermissionRequirement } from '@/lib/auth/mutation-permission';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { purchaseSatisfactionQueryKeys } from './query-keys';

export const useSetPurchaseSatisfactionChecked = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, checked }: { id: string; checked: boolean }) =>
      purchaseSatisfactionApi.setChecked(id, checked),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: purchaseSatisfactionQueryKeys.all });
    },
  });
};
useSetPurchaseSatisfactionChecked.permission = ['cs.satisfaction.manage'] as const satisfies PermissionRequirement;
