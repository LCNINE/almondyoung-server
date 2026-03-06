'use client';

import { authApi } from '@/lib/api';
import { useMutation } from '@tanstack/react-query';

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
    mutationFn: () => authApi.signout(),
  });
};
