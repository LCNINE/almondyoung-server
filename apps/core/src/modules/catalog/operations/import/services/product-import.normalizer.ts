import { Injectable } from '@nestjs/common';
import { ParsedWorkbook, CategoryNode, ProductRecord, NormalizedOption, comboKey } from '../dto/import.types';

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
        variantOverrides: [],
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

    const optionSeqByKey = new Map<string, number>();

    for (const row of parsed.options) {
      const productKey = row.cells.productKey ?? '';
      const optionName = (row.cells.optionName ?? '').trim();
      const values = (row.cells.optionValues ?? '')
        .split(VALUE_DELIMITER)
        .map((v) => v.trim())
        .filter((v) => v !== '');

      const rawSortOrder = (row.cells.sortOrder ?? '').trim();
      const parsedSortOrder = Number(rawSortOrder);
      let sortOrder: number;
      if (rawSortOrder !== '' && Number.isInteger(parsedSortOrder)) {
        sortOrder = parsedSortOrder;
      } else {
        const seq = (optionSeqByKey.get(productKey) ?? 0) + 1;
        optionSeqByKey.set(productKey, seq);
        sortOrder = seq;
      }

      const option: NormalizedOption = {
        displayName: optionName,
        values: values.map((displayName) => ({ displayName })),
        sortOrder,
      };

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
          variantOverrides: [],
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

    for (const row of parsed.variants) {
      const productKey = row.cells.productKey ?? '';
      const target = byKey.get(productKey);

      if (!target) {
        records.push({
          rowNumber: row.rowNumber,
          productKey,
          raw: {},
          version: {},
          categoryIds: [],
          categoryNames: [],
          options: [],
          variantOverrides: [],
          errors: [
            {
              sheet: 'Variants',
              rowNumber: row.rowNumber,
              message: `존재하지 않는 productKey 참조: ${productKey || '(빈 값)'}`,
            },
          ],
        });
        continue;
      }

      // target 은 여기부터 non-null 로 확정된다(위 continue). 클로저는 이 확정 이후에 정의해
      // 별도 fallback 없이도 항상 올바른 레코드에만 에러를 붙인다.
      const push = (message: string) => target.errors.push({ sheet: 'Variants', rowNumber: row.rowNumber, message });

      // 옵션축이 아예 없는(단일 variant) 상품에 Variants 행이 달린 경우: 기본 variant 는
      // reader 가 빈 문자열 키로 매핑하지만 어떤 producer 도 ''를 만들 수 없다 — 빈 조합은
      // 아래에서 "필수입니다"로, 채워진 조합은 축 조회 실패로 막혀 둘 다 "존재하지 않는
      // 옵션명"류 메시지가 된다. 실제 원인(이 상품엔 옵션이 없다)과 무관해 헷갈리므로
      // 여기서 먼저 걸러 하나의 명확한 메시지만 남긴다. 능력 자체(빈 조합 허용)는 바꾸지
      // 않는다 — 그건 Products 시트에 variantCode 컬럼을 추가하는 별도 스코프의 결정이다.
      if (target.options.length === 0) {
        push(
          '이 상품은 옵션이 없어 조합별(Variants) 가격 행을 사용할 수 없습니다. Products 시트의 기본가만 적용됩니다.',
        );
        continue;
      }

      const raw = (row.cells.optionCombination ?? '').trim();
      const pairs = raw
        .split(';')
        .map((chunk) => chunk.trim())
        .filter((chunk) => chunk !== '')
        .map((chunk) => {
          const idx = chunk.indexOf('=');
          return idx < 0
            ? { name: chunk, value: '' }
            : { name: chunk.slice(0, idx).trim(), value: chunk.slice(idx + 1).trim() };
        });

      if (pairs.length === 0) {
        push('optionCombination 은 필수입니다.');
        continue;
      }

      let valid = true;
      for (const pair of pairs) {
        const group = target.options.find((o) => o.displayName === pair.name);
        if (!group) {
          push(`Options 시트에 없는 옵션명입니다: ${pair.name}`);
          valid = false;
          continue;
        }
        if (!group.values.some((v) => v.displayName === pair.value)) {
          push(`Options 시트에 없는 옵션값입니다: ${pair.name}=${pair.value}`);
          valid = false;
        }
      }
      // pairs.length 를 options.length 와 단순 비교하면 같은 축이 두 번 지정되고 다른 축이
      // 생략된 경우 개수만 우연히 맞아 통과해버린다 — 이름 집합으로 비교해야 한다.
      const pairNames = pairs.map((pair) => pair.name);
      const uniquePairNames = new Set(pairNames);
      const duplicatedNames = [...uniquePairNames].filter((name) => pairNames.filter((n) => n === name).length > 1);
      if (duplicatedNames.length > 0) {
        push(`옵션 축이 중복 지정되었습니다 (${duplicatedNames.join(', ')}): ${raw}`);
        valid = false;
      }

      const axisNames = new Set(target.options.map((o) => o.displayName));
      const missingNames = [...axisNames].filter((name) => !uniquePairNames.has(name));
      if (missingNames.length > 0) {
        push(`옵션 축을 전부 지정해야 합니다 (누락된 축: ${missingNames.join(', ')}): ${raw}`);
        valid = false;
      }
      if (!valid) continue;

      const key = comboKey(pairs);
      const existing = target.variantOverrides.find((v) => v.comboKey === key);
      if (existing) {
        // 어느 쪽이 맞는지 알 수 없으므로 양쪽 다 오류로 남긴다
        push(`중복된 조합입니다: ${raw}`);
        target.errors.push({
          sheet: 'Variants',
          rowNumber: existing.rowNumber,
          message: `중복된 조합입니다: ${raw}`,
        });
        continue;
      }

      target.variantOverrides.push({
        rowNumber: row.rowNumber,
        comboKey: key,
        combination: pairs,
        basePriceRaw: (row.cells.basePrice ?? '').trim(),
        membershipPriceRaw: (row.cells.membershipPrice ?? '').trim(),
        variantCode: (row.cells.variantCode ?? '').trim() || undefined,
      });
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

    const segments = path
      .split('>')
      .map((s) => s.trim())
      .filter((s) => s !== '');
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
