export interface FileContextSeed {
  id: string;
  name: string;
  description: string | null;
  allowPublic: boolean;
  allowPrivate: boolean;
  allowedMimeTypes: string[];
  maxFileSize: number;
  pathPrefix: string;
  isActive: boolean;
}

export type FileContextSeedRow = {
  id: string;
  allow_public: boolean;
  allow_private: boolean;
  allowed_mime_types: unknown;
  max_file_size: number | string | bigint;
  path_prefix: string;
  is_active: boolean;
};

export const DIGITAL_ASSET_FILE_CONTEXT_ID = 'digital-asset-file';
export const DIGITAL_ASSET_FILE_MAX_SIZE_BYTES = 10 * 1024 * 1024 * 1024;

function normalizeAllowedMimeTypes(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  return [];
}

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function fileContextMatchesSeed(row: FileContextSeedRow | undefined, seed: FileContextSeed): boolean {
  if (!row) {
    return false;
  }

  return (
    row.allow_public === seed.allowPublic &&
    row.allow_private === seed.allowPrivate &&
    arraysEqual(normalizeAllowedMimeTypes(row.allowed_mime_types), seed.allowedMimeTypes) &&
    Number(row.max_file_size) === seed.maxFileSize &&
    row.path_prefix === seed.pathPrefix &&
    row.is_active === seed.isActive
  );
}

export const FILE_CONTEXTS: FileContextSeed[] = [
  {
    id: 'banner-image',
    name: 'Banner Image',
    description: '배너 이미지',
    allowPublic: true,
    allowPrivate: false,
    allowedMimeTypes: ['image/*'],
    maxFileSize: 10485760,
    pathPrefix: 'banners/images',
    isActive: true,
  },
  {
    id: 'business-verification-file',
    name: 'Business Verification',
    description: '사업자등록증',
    allowPublic: false,
    allowPrivate: true,
    allowedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png'],
    maxFileSize: 20971520,
    pathPrefix: 'business/verification',
    isActive: true,
  },
  {
    id: DIGITAL_ASSET_FILE_CONTEXT_ID,
    name: 'Digital Asset File',
    description: '라이브러리 디지털 자산 파일',
    allowPublic: false,
    allowPrivate: true,
    allowedMimeTypes: [],
    maxFileSize: DIGITAL_ASSET_FILE_MAX_SIZE_BYTES,
    pathPrefix: 'library/digital-assets',
    isActive: true,
  },
  {
    id: 'category-image',
    name: 'Category Image',
    description: '카테고리 이미지',
    allowPublic: true,
    allowPrivate: false,
    allowedMimeTypes: ['image/*'],
    maxFileSize: 10485760,
    pathPrefix: 'categories/images',
    isActive: true,
  },
  {
    id: 'cs-inquiry',
    name: 'cs inquiry',
    description: 'cs문의 이미지',
    allowPublic: true,
    allowPrivate: true,
    allowedMimeTypes: ['image/*'],
    maxFileSize: 10485760,
    pathPrefix: 'cs/inquiry',
    isActive: true,
  },
  {
    id: 'invoice',
    name: 'Invoice',
    description: '세금계산서',
    allowPublic: false,
    allowPrivate: true,
    allowedMimeTypes: ['application/pdf'],
    maxFileSize: 10485760,
    pathPrefix: 'finance/invoices',
    isActive: true,
  },
  {
    id: 'notice-content-image',
    name: 'Notice Content Image',
    description: '공지사항 본문 이미지',
    allowPublic: true,
    allowPrivate: false,
    allowedMimeTypes: ['image/*'],
    maxFileSize: 10485760,
    pathPrefix: 'notices/content-image',
    isActive: true,
  },
  {
    id: 'product-description-image',
    name: 'Product Description Image',
    description: '상품 상세설명 본문 이미지',
    allowPublic: true,
    allowPrivate: false,
    allowedMimeTypes: ['image/*'],
    maxFileSize: 20971520,
    pathPrefix: 'products/description-image',
    isActive: true,
  },
  {
    id: 'product-image',
    name: 'Product Image',
    description: '상품 이미지',
    allowPublic: true,
    allowPrivate: false,
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    maxFileSize: 10485760,
    pathPrefix: 'products/images',
    isActive: true,
  },
  {
    id: 'product-variant-image',
    name: 'Product Variant Image',
    description: '상품 품목 이미지',
    allowPublic: true,
    allowPrivate: false,
    allowedMimeTypes: ['image/*'],
    maxFileSize: 10485760,
    pathPrefix: 'products/variants/images',
    isActive: true,
  },
  {
    id: 'receipt',
    name: 'Receipt',
    description: '영수증',
    allowPublic: false,
    allowPrivate: true,
    allowedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png'],
    maxFileSize: 5242880,
    pathPrefix: 'finance/receipts',
    isActive: true,
  },
  {
    id: 'review-media',
    name: 'Review Media',
    description: '리뷰 이미지',
    allowPublic: true,
    allowPrivate: false,
    allowedMimeTypes: ['image/*', 'video/*'],
    maxFileSize: 104857600,
    pathPrefix: 'reviews/media',
    isActive: true,
  },
  {
    id: 'shipment-label',
    name: 'Shipment Label',
    description: '택배 송장 (운송장)',
    allowPublic: false,
    allowPrivate: true,
    allowedMimeTypes: ['application/pdf', 'image/png'],
    maxFileSize: 5242880,
    pathPrefix: 'shipments/labels',
    isActive: true,
  },
  {
    id: 'user-avatar',
    name: 'User Avatar',
    description: '사용자 프로필 사진',
    allowPublic: true,
    allowPrivate: true,
    allowedMimeTypes: ['image/*'],
    maxFileSize: 5242880,
    pathPrefix: 'users/avatars',
    isActive: true,
  },
  {
    id: 'user-document',
    name: 'User Document',
    description: '신분증, 개인 서류',
    allowPublic: false,
    allowPrivate: true,
    allowedMimeTypes: ['image/jpeg', 'image/png', 'application/pdf', 'text/plain', 'text/csv', 'application/json'],
    maxFileSize: 20971520,
    pathPrefix: 'users/documents',
    isActive: true,
  },
];
