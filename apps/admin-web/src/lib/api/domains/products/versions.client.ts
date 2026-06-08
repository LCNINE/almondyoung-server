'use client';

import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  MasterVersionDto,
  CreateDraftVersionDto,
} from '../../../types/dto/products';
import type {
  BulkUpdateProductVariantDto,
  BulkUpdateProductVariantResultDto,
  DeleteDraftVersionResultDto,
  MasterVersionDetailDto,
  PublishProductVersionResultDto,
  UpdateProductVariantDto,
  UpdateProductVariantResultDto,
  UpdateMasterVersionDto,
} from '@/lib/services/products/products-detail.types';

const base = (masterId: string) =>
  `${ALMONDYOUNG_API_BASE_URL}/masters/${masterId}/versions`;

export const versionsClient = {
  listByMaster: async (masterId: string): Promise<MasterVersionDto[]> =>
    (await client.get(base(masterId))).data,

  getActive: async (masterId: string): Promise<MasterVersionDto> =>
    (await client.get(`${base(masterId)}/active`)).data,

  getById: async (
    masterId: string,
    versionId: string
  ): Promise<MasterVersionDetailDto> =>
    (await client.get(`${base(masterId)}/${versionId}`)).data,

  createDraft: async (
    masterId: string,
    dto: CreateDraftVersionDto
  ): Promise<MasterVersionDto> => (await client.post(base(masterId), dto)).data,

  update: async (
    masterId: string,
    versionId: string,
    dto: UpdateMasterVersionDto
  ): Promise<MasterVersionDetailDto> =>
    (await client.put(`${base(masterId)}/${versionId}`, dto)).data,

  publish: async (
    masterId: string,
    versionId: string
  ): Promise<PublishProductVersionResultDto> =>
    (await client.patch(`${base(masterId)}/${versionId}/publish`)).data,

  deleteDraft: async (
    masterId: string,
    versionId: string
  ): Promise<DeleteDraftVersionResultDto> =>
    (await client.delete(`${base(masterId)}/${versionId}`)).data,

  updateVariant: async (
    masterId: string,
    versionId: string,
    variantId: string,
    dto: UpdateProductVariantDto
  ): Promise<UpdateProductVariantResultDto> =>
    (
      await client.put(
        `${base(masterId)}/${versionId}/variants/${variantId}`,
        dto
      )
    ).data,

  bulkUpdateVariants: async (
    masterId: string,
    versionId: string,
    dto: BulkUpdateProductVariantDto
  ): Promise<BulkUpdateProductVariantResultDto> =>
    (await client.put(`${base(masterId)}/${versionId}/variants/bulk`, dto))
      .data,
};
