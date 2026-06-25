'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { libraryQueryKeys } from './query-keys';
import { digitalAssetsClient, ownershipsClient, variantAssetLinksClient } from '@/lib/api/domains/library';
import type {
  CreateDigitalAssetDto,
  CreateFileVersionDto,
  GrantOwnershipDto,
  SetVariantAssetLinksDto,
  UpdateDigitalAssetDto,
} from '@/lib/types/dto/library';

export const useCreateDigitalAsset = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateDigitalAssetDto) => digitalAssetsClient.create(dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: libraryQueryKeys.digitalAssets() });
    },
  });
};

export const useUpdateDigitalAsset = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: UpdateDigitalAssetDto }) =>
      digitalAssetsClient.update(id, dto),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: libraryQueryKeys.digitalAssets() });
      qc.invalidateQueries({ queryKey: libraryQueryKeys.digitalAsset(vars.id) });
    },
  });
};

export const useDeleteDigitalAsset = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => digitalAssetsClient.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: libraryQueryKeys.digitalAssets() });
    },
  });
};

export const useAddFileVersion = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: CreateFileVersionDto }) =>
      digitalAssetsClient.addFileVersion(id, dto),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: libraryQueryKeys.digitalAsset(vars.id) });
      qc.invalidateQueries({ queryKey: libraryQueryKeys.digitalAssetFileVersions(vars.id) });
    },
  });
};

export const useRollbackFileVersion = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, versionId }: { id: string; versionId: string }) =>
      digitalAssetsClient.rollbackToFileVersion(id, versionId),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: libraryQueryKeys.digitalAsset(vars.id) });
      qc.invalidateQueries({ queryKey: libraryQueryKeys.digitalAssetFileVersions(vars.id) });
    },
  });
};

export const useSetVariantAssetLinks = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ variantId, dto }: { variantId: string; dto: SetVariantAssetLinksDto }) =>
      variantAssetLinksClient.set(variantId, dto),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: libraryQueryKeys.variantAssets(vars.variantId) });
    },
  });
};

export const useGrantOwnership = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: GrantOwnershipDto) => ownershipsClient.grant(dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: libraryQueryKeys.ownerships() });
    },
  });
};

export const useRevokeOwnership = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      ownershipsClient.revoke(id, reason ? { reason } : undefined),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: libraryQueryKeys.ownerships() });
    },
  });
};

export const useResendOwnership = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => ownershipsClient.resend(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: libraryQueryKeys.ownerships() });
    },
  });
};
