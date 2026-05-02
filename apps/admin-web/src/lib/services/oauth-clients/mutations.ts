'use client';

import {
  CreateOAuthClientDto,
  oauthClientApi,
  UpdateOAuthClientDto,
} from '@/lib/api/domains/oauth-clients';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { oauthClientsQueryKeys } from './query-keys';

const invalidate = (qc: ReturnType<typeof useQueryClient>) =>
  qc.invalidateQueries({ queryKey: oauthClientsQueryKeys.all });

export const useCreateOAuthClient = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateOAuthClientDto) => oauthClientApi.create(dto),
    onSuccess: () => invalidate(qc),
  });
};

export const useUpdateOAuthClient = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ clientId, dto }: { clientId: string; dto: UpdateOAuthClientDto }) =>
      oauthClientApi.update(clientId, dto),
    onSuccess: () => invalidate(qc),
  });
};

export const useRotateOAuthClientSecret = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (clientId: string) => oauthClientApi.rotateSecret(clientId),
    onSuccess: () => invalidate(qc),
  });
};

export const useClearOAuthClientPreviousSecret = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (clientId: string) => oauthClientApi.clearPreviousSecret(clientId),
    onSuccess: () => invalidate(qc),
  });
};

export const useDeactivateOAuthClient = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (clientId: string) => oauthClientApi.deactivate(clientId),
    onSuccess: () => invalidate(qc),
  });
};
