'use client';

import { useQuery } from '@tanstack/react-query';
import { libraryQueryKeys } from './query-keys';
import { digitalAssetsClient, ownershipsClient, variantAssetLinksClient } from '@/lib/api/domains/library';
import type { AdminOwnershipListQuery, DigitalAssetListQuery } from '@/lib/types/dto/library';

export const useDigitalAssets = (query?: DigitalAssetListQuery) => {
  return useQuery({
    queryKey: libraryQueryKeys.digitalAssetsList(query ?? {}),
    queryFn: () => digitalAssetsClient.list(query),
    staleTime: 30 * 1000,
  });
};

export const useDigitalAsset = (id: string | undefined) => {
  return useQuery({
    queryKey: libraryQueryKeys.digitalAsset(id ?? ''),
    queryFn: () => digitalAssetsClient.get(id as string),
    enabled: !!id,
    staleTime: 30 * 1000,
  });
};

export const useDigitalAssetFileVersions = (id: string | undefined) => {
  return useQuery({
    queryKey: libraryQueryKeys.digitalAssetFileVersions(id ?? ''),
    queryFn: () => digitalAssetsClient.listFileVersions(id as string),
    enabled: !!id,
    staleTime: 30 * 1000,
  });
};

export const useVariantAssets = (variantId: string | undefined) => {
  return useQuery({
    queryKey: libraryQueryKeys.variantAssets(variantId ?? ''),
    queryFn: () => variantAssetLinksClient.list(variantId as string),
    enabled: !!variantId,
    staleTime: 30 * 1000,
  });
};

export const useAdminOwnerships = (query?: AdminOwnershipListQuery) => {
  return useQuery({
    queryKey: libraryQueryKeys.ownershipsList(query ?? {}),
    queryFn: () => ownershipsClient.list(query),
    staleTime: 30 * 1000,
  });
};
