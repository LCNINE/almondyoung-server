'use client';

import {
  CreateOAuthClientDto,
  oauthClientApi,
  UpdateOAuthClientDto,
} from '@/lib/api/domains/oauth-clients';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { oauthClientsQueryKeys } from './query-keys';
import type { PermissionRequirement } from '@/lib/auth/mutation-permission';

const invalidate = (qc: ReturnType<typeof useQueryClient>) =>
  qc.invalidateQueries({ queryKey: oauthClientsQueryKeys.all });

export const useCreateOAuthClient = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateOAuthClientDto) => oauthClientApi.create(dto),
    onSuccess: () => invalidate(qc),
  });
};
useCreateOAuthClient.permission = ['system.oauth_client.write'] as const satisfies PermissionRequirement;

export const useUpdateOAuthClient = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ clientId, dto }: { clientId: string; dto: UpdateOAuthClientDto }) =>
      oauthClientApi.update(clientId, dto),
    onSuccess: () => invalidate(qc),
  });
};
useUpdateOAuthClient.permission = ['system.oauth_client.write'] as const satisfies PermissionRequirement;

export const useRotateOAuthClientSecret = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (clientId: string) => oauthClientApi.rotateSecret(clientId),
    onSuccess: () => invalidate(qc),
  });
};
useRotateOAuthClientSecret.permission = ['system.oauth_client.write'] as const satisfies PermissionRequirement;

export const useClearOAuthClientPreviousSecret = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (clientId: string) => oauthClientApi.clearPreviousSecret(clientId),
    onSuccess: () => invalidate(qc),
  });
};
useClearOAuthClientPreviousSecret.permission = ['system.oauth_client.write'] as const satisfies PermissionRequirement;

export const useDeactivateOAuthClient = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (clientId: string) => oauthClientApi.deactivate(clientId),
    onSuccess: () => invalidate(qc),
  });
};
useDeactivateOAuthClient.permission = ['system.oauth_client.write'] as const satisfies PermissionRequirement;
