import { Injectable } from '@nestjs/common';
import { ParsedWorkbook, CategoryNode, ProductRecord, NormalizedOption, RowError } from '../dto/import.types';

const VALUE_DELIMITER = '|';

@Injectable()
export class ProductImportNormalizer {
  normalize(parsed: ParsedWorkbook, categories: CategoryNode[]): ProductRecord[] {
    const bySlug = new Map(categories.map((c) => [c.slug, c]));
    const byParent = new Map<string | null, CategoryNode[]>();
    for (const c of categories) {
      const list = byParent.get(c.parentId) ?? [];
      list.push(c);
      byParent.set(c.parentId, list);
    }
    const byId = new Map(categories.map((c) => [c.id, c]));

    const records: ProductRecord[] = [];
    const byKey = new Map<string, ProductRecord>();
    const seenKeys = new Set<string>();

    for (const row of parsed.products) {
      const productKey = row.cells.productKey ?? '';
      const record: ProductRecord = {
        rowNumber: row.rowNumber,
        productKey,
        raw: row.cells,
        version: {},
        categoryIds: [],
        categoryNames: [],
        options: [],
        errors: [],
      };

      if (productKey && seenKeys.has(productKey)) {
        record.errors.push({ sheet: 'Products', rowNumber: row.rowNumber, message: `중복 productKey: ${productKey}` });
      }
      if (productKey) {
        seenKeys.add(productKey);
        if (!byKey.has(productKey)) byKey.set(productKey, record);
      }

      const path = (row.cells.categoryPath ?? '').trim();
      if (path) {
        const resolved = this.resolveCategory(path, bySlug, byParent, byId);
        if (resolved) {
          record.categoryIds = [resolved.id];
          record.primaryCategoryId = resolved.id;
          record.categoryNames = resolved.names;
        } else {
          record.errors.push({
            sheet: 'Products',
            rowNumber: row.rowNumber,
            message: `카테고리 경로를 해석할 수 없습니다(미존재 또는 동명 모호): ${path}`,
          });
        }
      }

      records.push(record);
    }

    for (const row of parsed.options) {
      const productKey = row.cells.productKey ?? '';
      const optionName = (row.cells.optionName ?? '').trim();
      const values = (row.cells.optionValues ?? '')
        .split(VALUE_DELIMITER)
        .map((v) => v.trim())
        .filter((v) => v !== '');
      const option: NormalizedOption = { displayName: optionName, values: values.map((displayName) => ({ displayName })) };

      const target = byKey.get(productKey);
      if (!target) {
        const stub: ProductRecord = {
          rowNumber: row.rowNumber,
          productKey,
          raw: {},
          version: {},
          categoryIds: [],
          categoryNames: [],
          options: [option],
          errors: [
            {
              sheet: 'Options',
              rowNumber: row.rowNumber,
              message: `존재하지 않는 productKey 참조: ${productKey || '(빈 값)'}`,
            },
          ],
        };
        records.push(stub);
        continue;
      }
      target.options.push(option);
    }

    return records;
  }

  private resolveCategory(
    path: string,
    bySlug: Map<string, CategoryNode>,
    byParent: Map<string | null, CategoryNode[]>,
    byId: Map<string, CategoryNode>,
  ): { id: string; names: string[] } | null {
    const bySlugHit = bySlug.get(path.trim());
    if (bySlugHit) {
      const names = this.ancestorNames(bySlugHit, byId);
      return { id: bySlugHit.id, names };
    }

    const segments = path.split('>').map((s) => s.trim()).filter((s) => s !== '');
    if (segments.length === 0) return null;

    let parentId: string | null = null;
    let current: CategoryNode | null = null;
    for (const segment of segments) {
      const matches = (byParent.get(parentId) ?? []).filter((c) => c.name === segment);
      const only = matches.length === 1 ? matches[0] : undefined;
      if (!only) return null; // 미존재 또는 모호
      current = only;
      parentId = only.id;
    }
    if (!current) return null;
    return { id: current.id, names: this.ancestorNames(current, byId) };
  }

  private ancestorNames(node: CategoryNode, byId: Map<string, CategoryNode>): string[] {
    const names: string[] = [];
    let cursor: CategoryNode | undefined = node;
    while (cursor) {
      names.unshift(cursor.name);
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    }
    return names;
  }
}
