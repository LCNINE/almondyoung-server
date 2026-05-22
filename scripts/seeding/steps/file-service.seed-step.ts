import { sql } from 'drizzle-orm';
import { SeedStep } from './base-seed-step';
import { SeedCheckResult, SeedApplyResult } from '../lib/types';

interface FileContextSeed {
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

const FILE_CONTEXTS: FileContextSeed[] = [
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
    allowedMimeTypes: [
      'image/jpeg',
      'image/png',
      'application/pdf',
      'text/plain',
      'text/csv',
      'application/json',
    ],
    maxFileSize: 20971520,
    pathPrefix: 'users/documents',
    isActive: true,
  },
];

const CONTEXT_IDS = FILE_CONTEXTS.map((c) => c.id);
const CONTEXT_NAMES: Record<string, string> = Object.fromEntries(
  FILE_CONTEXTS.map((c) => [c.id, c.name]),
);

export class FileServiceSeedStep extends SeedStep {
  readonly groups = ['baseline'] as const;

  constructor(databaseUrl: string) {
    super('File Service', databaseUrl);
  }

  async check(): Promise<SeedCheckResult> {
    const existing = await this.findExistingIds('file_contexts', CONTEXT_IDS);
    const missingIds = CONTEXT_IDS.filter((id) => !existing.has(id));

    const items = [
      {
        entity: 'file_contexts',
        expected: CONTEXT_IDS.length,
        existing: existing.size,
        missing: missingIds.length,
        missingDetails: missingIds.map((id) => CONTEXT_NAMES[id]),
      },
    ];

    const isFullySeeded = missingIds.length === 0;
    return {
      service: 'File Service',
      items,
      isFullySeeded,
      summary: isFullySeeded
        ? 'All File Service seed data present'
        : `${missingIds.length} missing record(s)`,
    };
  }

  async apply(): Promise<SeedApplyResult> {
    const start = Date.now();

    try {
      this.logger.step(1, 1, 'Inserting file_contexts');
      for (const ctx of FILE_CONTEXTS) {
        await this.db.execute(sql`
          INSERT INTO file_contexts (
            id, name, description, allow_public, allow_private,
            allowed_mime_types, max_file_size, path_prefix, is_active
          )
          VALUES (
            ${ctx.id},
            ${ctx.name},
            ${ctx.description},
            ${ctx.allowPublic},
            ${ctx.allowPrivate},
            ${JSON.stringify(ctx.allowedMimeTypes)},
            ${ctx.maxFileSize},
            ${ctx.pathPrefix},
            ${ctx.isActive}
          )
          ON CONFLICT (id) DO NOTHING
        `);
      }

      this.logger.success('File Service seeding completed');
      return {
        service: 'File Service',
        success: true,
        itemsApplied: FILE_CONTEXTS.length,
        duration: Date.now() - start,
      };
    } catch (error: any) {
      this.logger.error('File Service seeding failed', error);
      return {
        service: 'File Service',
        success: false,
        itemsApplied: 0,
        duration: Date.now() - start,
        error: error.message,
      };
    }
  }
}
