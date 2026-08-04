import { Injectable } from '@nestjs/common';
import { DbTransaction } from '../../../catalog.types';
import { ProductCategoriesService } from '../../../core/categories/categories.service';
import { flattenCategoryTree } from './form-export.snapshot.reader';
import { buildFormWorkbook } from './form-export.workbook';

/**
 * 빈 양식(신규 전용) 워크북을 만든다.
 *
 * 잡도 스냅샷도 만들지 않는다 — 프리필할 상품이 없으므로 읽을 것이 카테고리 트리뿐이고,
 * 그래서 ALB 60초 안에 동기로 끝난다. 양식 잡 경로(POST /product-forms)와 달리 만료도
 * 없다: `exportId` 를 심지 않아 워크북이 어떤 잡에도 매이지 않는다(form-export.workbook.ts).
 */
@Injectable()
export class FormExportBlankBuilder {
  constructor(private readonly categories: ProductCategoriesService) {}

  async build(tx?: DbTransaction): Promise<Buffer> {
    // 스냅샷 리더와 같은 규약으로 읽는다 — includeInactive=true 로 트리를 받고
    // 참조 시트에는 활성만 싣는다(비활성 카테고리는 새로 고를 수 없어야 한다).
    const tree = await this.categories.getCategoryTree(undefined, true, tx);
    const categoryPaths = flattenCategoryTree(tree.categories)
      .filter((c) => c.isActive)
      .map((c) => c.path);

    return buildFormWorkbook({
      exportId: null,
      products: [],
      options: [],
      variants: [],
      categories: [],
      constraints: [],
      images: [],
      categoryPaths,
    });
  }
}
