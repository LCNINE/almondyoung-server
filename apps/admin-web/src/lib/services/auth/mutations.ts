'use client';

import { authApi } from '@/lib/api';
import { useMutation } from '@tanstack/react-query';
import { disableAttendancePush } from '@/features/attendance/lib/browser-push';

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
