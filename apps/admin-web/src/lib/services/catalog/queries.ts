'use client';

import { useQuery } from '@tanstack/react-query';
import { medusaCatalogApi } from '@/lib/api/domains/medusa/catalog';
import { catalogQueryKeys } from './query-keys';

export const useProductSearch = (q: string, enabled = true) =>
  useQuery({
    queryKey: catalogQueryKeys.products(q),
    queryFn: () => medusaCatalogApi.searchProducts(q || undefined),
    enabled,
    staleTime: 30_000,
  });

export const useCategoryList = (q: string, enabled = true) =>
  useQuery({
    queryKey: catalogQueryKeys.categories(q),
    queryFn: () => medusaCatalogApi.listCategories(q || undefined),
    enabled,
    staleTime: 60_000,
  });

export const useCollectionList = (q: string, enabled = true) =>
  useQuery({
    queryKey: catalogQueryKeys.collections(q),
    queryFn: () => medusaCatalogApi.listCollections(q || undefined),
    enabled,
    staleTime: 60_000,
  });
