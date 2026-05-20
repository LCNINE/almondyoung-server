export const catalogQueryKeys = {
  products: (q?: string) => ['catalog', 'products', q ?? ''] as const,
  categories: (q?: string) => ['catalog', 'categories', q ?? ''] as const,
  collections: (q?: string) => ['catalog', 'collections', q ?? ''] as const,
};
