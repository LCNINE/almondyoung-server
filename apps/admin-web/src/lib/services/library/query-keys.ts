export const libraryQueryKeys = {
  all: ['library'] as const,
  digitalAssets: () => [...libraryQueryKeys.all, 'digital-assets'] as const,
  digitalAssetsList: (query: unknown) =>
    [...libraryQueryKeys.digitalAssets(), 'list', query] as const,
  digitalAsset: (id: string) => [...libraryQueryKeys.digitalAssets(), 'detail', id] as const,
  digitalAssetFileVersions: (id: string) =>
    [...libraryQueryKeys.digitalAssets(), 'file-versions', id] as const,
  variantAssets: (variantId: string) =>
    [...libraryQueryKeys.all, 'variant-assets', variantId] as const,
  ownerships: () => [...libraryQueryKeys.all, 'ownerships'] as const,
  ownershipsList: (query: unknown) =>
    [...libraryQueryKeys.ownerships(), 'list', query] as const,
};
