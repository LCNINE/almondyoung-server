'use client';

import { authApi } from '@/lib/api';
import { useMutation } from '@tanstack/react-query';
import { disableAttendancePush } from '@/features/attendance/lib/browser-push';
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
    mutationFn: async () => {
      try {
        await disableAttendancePush();
      } catch {
        // Sign-out still clears authentication. The worker also verifies the current account before display.
      }

      return authApi.signout();
    },
  });
};
useSignout.permission = 'self' as const satisfies PermissionRequirement;
