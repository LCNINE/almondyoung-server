import { Injectable } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import { inArray, sql } from 'drizzle-orm';
import { PimSchema, productBulkImages, productImages, productMasterVersions } from '../../schema/catalog.schema';

/** 한 번에 물어볼 수 있는 fileId 수. 본문 스캔이 후보 수와 무관하게 1회라 배치가 클수록 이득이다. */
export const MAX_REFERENCE_QUERY_IDS = 500;

/** 상세설명 본문에 박힌 fileId 를 뽑는 정규식. `::product-image{fileId="..."}` 형태로 들어간다. */
const UUID_IN_TEXT = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

@Injectable()
export class ProductFileReferencesService {
  constructor(@InjectDb() private readonly db: DbService<PimSchema>) {}

  /**
   * 준 fileId 중 상품에 실제로 붙어 있는 것만 돌려준다.
   *
   * 상세설명 이미지는 테이블이 아니라 본문 마크다운 안에서만 참조된다. 컬럼만 보면
   * 살아 있는 이미지가 미참조로 판정되므로 본문도 같이 본다.
   */
  async findReferenced(fileIds: string[]): Promise<string[]> {
    const ids = [...new Set(fileIds)].slice(0, MAX_REFERENCE_QUERY_IDS);
    if (ids.length === 0) return [];

    const referenced = new Set<string>();

    const images = await this.db.db
      .select({ fileId: productImages.fileId })
      .from(productImages)
      .where(inArray(productImages.fileId, ids));
    images.forEach((row) => referenced.add(row.fileId));

    const bulkImages = await this.db.db
      .select({ fileId: productBulkImages.fileId })
      .from(productBulkImages)
      .where(inArray(productBulkImages.fileId, ids));
    bulkImages.forEach((row) => row.fileId && referenced.add(row.fileId));

    const thumbnails = await this.db.db
      .select({ thumbnail: productMasterVersions.thumbnail })
      .from(productMasterVersions)
      .where(inArray(productMasterVersions.thumbnail, ids));
    thumbnails.forEach((row) => row.thumbnail && referenced.add(row.thumbnail));

    const remaining = ids.filter((id) => !referenced.has(id));
    for (const id of await this.findInDescriptions(remaining)) {
      referenced.add(id);
    }

    return [...referenced];
  }

  /**
   * 본문에 박힌 fileId. 후보마다 LIKE 를 돌리면 스캔이 후보 수만큼 곱해지므로,
   * 버전을 한 번 훑으면서 나온 UUID 를 후보 집합과 맞춘다.
   */
  private async findInDescriptions(ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];

    // 후보를 배열로 넘기면 drizzle 이 `any(($2, $3))` 로 펼쳐서 42809 로 죽는다.
    // 쉼표로 이어 한 파라미터로 넘기고 Postgres 쪽에서 배열로 만든다.
    const rows = await this.db.db.execute<{ file_id: string }>(sql`
      select distinct m[1] as file_id
      from product_master_versions v,
           regexp_matches(coalesce(v.description, '') || coalesce(v.description_html, ''), ${UUID_IN_TEXT}, 'g') m
      where m[1] = any(string_to_array(${ids.join(',')}, ','))
    `);

    return [...rows].map((row) => row.file_id);
  }
}
