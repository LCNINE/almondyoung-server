'use client';

import { authApi } from '@/lib/api';
import { useMutation } from '@tanstack/react-query';
import type { PermissionRequirement } from '@/lib/auth/mutation-permission';

export const useSignin = () => {
  return useMutation({
    mutationFn: ({
      loginId,
      password,
      rememberMe,
    }: {
      loginId: string;
      password: string;
      rememberMe?: boolean;
    }) => authApi.signin(loginId, password, rememberMe),
  });
};
useSignin.permission = 'self' as const satisfies PermissionRequirement;

export const useSignout = () => {
  return useMutation({
    mutationFn: () => authApi.signout(),
  });
};
useSignout.permission = 'self' as const satisfies PermissionRequirement;
