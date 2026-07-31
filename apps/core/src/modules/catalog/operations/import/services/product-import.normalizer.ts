import { Injectable } from '@nestjs/common';
import {
  ParsedWorkbook,
  CategoryNode,
  ProductRecord,
  NormalizedOption,
  RawRow,
  RowError,
  ImageSourceRef,
  MAX_ADDITIONAL_IMAGE_KEYS,
  comboKey,
  parseBoolCell,
} from '../dto/import.types';
import { extractDirectiveImageKeys } from './product-import-image.directive';

const VALUE_DELIMITER = '|';
/** Products 루프와 Categories 시트 핸들러가 공유하는 문구 — 두 호출부에서 byte-identical 이어야 한다. */
const UNRESOLVABLE_CATEGORY_PATH = '카테고리 경로를 해석할 수 없습니다(미존재 또는 동명 모호)';

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

    // Images 시트를 먼저 사전으로 만든다 — Products 루프가 키를 해석해야 하므로.
    // 시트 자체의 오류(중복 키·잘못된 URL)는 붙일 상품이 없으므로 스텁 레코드로 남긴다.
    // 스텁은 별도 배열에 모았다가 Products 루프가 끝난 뒤 records 에 합친다 — 다른 시트의
    // orphan 스텁(Options/Variants/Categories/Constraints)도 전부 Products 루프 뒤에
    // 붙으므로, records[0] 이 항상 상품 레코드라는 불변식을 여기서도 지킨다.
    const imageStubs: ProductRecord[] = [];
    const imageSources = this.buildImageSources(parsed.images, imageStubs);

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
            message: `${UNRESOLVABLE_CATEGORY_PATH}: ${path}`,
          });
        }
      }

      this.applyImageKeys(record, imageSources);

      records.push(record);
    }

    records.push(...imageStubs);

    this.applyCategorySheet(parsed.categories, records, byKey, bySlug, byParent, byId);
    this.applyConstraintSheet(parsed.constraints, records, byKey);

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
        // 공통 stub 은 options: [] 로 시작하므로, 이 옵션 자체는 stub 을 만든 뒤 따로 심는다.
        const stub = this.orphanRecord('Options', row);
        stub.options = [option];
        records.push(stub);
        continue;
      }
      target.options.push(option);
    }

    for (const row of parsed.variants) {
      const productKey = row.cells.productKey ?? '';
      const target = byKey.get(productKey);

      if (!target) {
        records.push(this.orphanRecord('Variants', row));
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
        basePriceRaw: (row.cells.basePrice ?? '').trim(),
        membershipPriceRaw: (row.cells.membershipPrice ?? '').trim(),
        variantCode: (row.cells.variantCode ?? '').trim() || undefined,
      });
    }

    return records;
  }

  /**
   * 다른 시트가 존재하지 않는 productKey 를 참조했을 때 남기는 stub 레코드.
   * 상품 본문이 없으므로 raw 는 비어 있고, validator 는 그걸 보고 필드 검증을 skip 한다.
   * 메시지는 네 호출부(Options/Variants/Categories/Constraints) 모두 동일하므로 여기 하나로 모은다.
   */
  private orphanRecord(sheet: RowError['sheet'], row: RawRow): ProductRecord {
    const productKey = row.cells.productKey ?? '';
    return {
      rowNumber: row.rowNumber,
      productKey,
      raw: {},
      version: {},
      categoryIds: [],
      categoryNames: [],
      options: [],
      variantOverrides: [],
      errors: [
        { sheet, rowNumber: row.rowNumber, message: `존재하지 않는 productKey 참조: ${productKey || '(빈 값)'}` },
      ],
    };
  }

  /**
   * Images 시트 → `imageKey` → `sourceUrl` 사전.
   *
   * **형식만 본다.** 도달 가능성·MIME·크기는 다운로드해봐야 알고 그건 워커 시점이다
   * (스펙 §3.2.2 — /validate 는 ALB 60초 천장에 걸리므로 probe 를 워커로 옮겼다).
   */
  private buildImageSources(rows: RawRow[], records: ProductRecord[]): Map<string, string> {
    const sources = new Map<string, string>();

    for (const row of rows) {
      const imageKey = (row.cells.imageKey ?? '').trim();
      const sourceUrl = (row.cells.sourceUrl ?? '').trim();

      if (imageKey === '') {
        records.push(this.imageSheetStub(row, 'imageKey 는 필수입니다.'));
        continue;
      }
      if (sourceUrl === '') {
        records.push(this.imageSheetStub(row, `sourceUrl 는 필수입니다: ${imageKey}`));
        continue;
      }
      if (sources.has(imageKey)) {
        // 나중 행이 조용히 앞 행을 덮으면 어느 URL 이 쓰였는지 파일만 봐서는 알 수 없다.
        records.push(this.imageSheetStub(row, `중복 imageKey: ${imageKey}`));
        continue;
      }
      if (!this.isHttpUrl(sourceUrl)) {
        records.push(
          this.imageSheetStub(row, `sourceUrl 는 http/https URL 이어야 합니다: ${imageKey} → ${sourceUrl}`),
        );
        continue;
      }

      sources.set(imageKey, sourceUrl);
    }

    return sources;
  }

  /** `new URL()` 로 파싱되고 스킴이 http/https 인지만 본다. SSRF 가드(사설 IP 등)는 워커가 건다. */
  private isHttpUrl(value: string): boolean {
    try {
      const url = new URL(value);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }

  /**
   * Images 시트 행 자체의 오류. 상품에 붙지 않으므로 고아 참조와 같은 스텁 레코드로 남긴다 —
   * 그래야 프리뷰에 invalid 행으로 뜨고 acceptCommit 의 invalidCount 에도 들어간다.
   */
  private imageSheetStub(row: RawRow, message: string): ProductRecord {
    return {
      rowNumber: row.rowNumber,
      productKey: (row.cells.imageKey ?? '').trim(),
      raw: {},
      version: {},
      categoryIds: [],
      categoryNames: [],
      options: [],
      variantOverrides: [],
      imageRefs: [],
      errors: [{ sheet: 'Images', rowNumber: row.rowNumber, message }],
    };
  }

  /**
   * 상품 행의 이미지 키 3종(대표·부가·본문)을 해석해 `imageRefs` 로 접합한다.
   *
   * 용도는 **참조 지점**이 정한다(스펙 §3.1). 같은 키가 대표와 본문 양쪽에 등장하면 ref 가
   * 둘 생기고, 워커가 서로 다른 file-service 컨텍스트로 두 번 올린다 — 컨텍스트별 MIME·크기
   * 제약이 다르기 때문이다(product-image 는 jpeg/png/webp 10MB, description 은 image/* 20MB).
   */
  private applyImageKeys(record: ProductRecord, sources: Map<string, string>): void {
    const push = (message: string) => record.errors.push({ sheet: 'Products', rowNumber: record.rowNumber, message });

    const thumbnail = (record.raw.thumbnailImageKey ?? '').trim();
    const additional = (record.raw.additionalImageKeys ?? '')
      .split(VALUE_DELIMITER)
      .map((key) => key.trim())
      .filter((key) => key !== '');
    const description = extractDirectiveImageKeys(record.raw.description);

    record.additionalImageKeys = additional;
    record.descriptionImageKeys = description;
    if (thumbnail !== '') record.thumbnailImageKey = thumbnail;

    if (additional.length > MAX_ADDITIONAL_IMAGE_KEYS) {
      push(`부가 이미지는 최대 ${MAX_ADDITIONAL_IMAGE_KEYS}개까지 지정할 수 있습니다 (현재 ${additional.length}개).`);
    }
    const duplicated = additional.filter((key, index) => additional.indexOf(key) !== index);
    if (duplicated.length > 0) {
      push(`additionalImageKeys 에 같은 키가 중복 지정되었습니다: ${[...new Set(duplicated)].join(', ')}`);
    }

    const refs: ImageSourceRef[] = [];
    const seen = new Set<string>();
    const add = (imageKey: string, usage: ImageSourceRef['usage']): void => {
      const sourceUrl = sources.get(imageKey);
      if (!sourceUrl) {
        push(`Images 시트에 정의되지 않은 imageKey 참조: ${imageKey}`);
        return;
      }
      // 같은 상품이 같은 (키, 용도) 를 두 번 가리켜도 ref 는 하나다 — 대표와 부가에
      // 같은 키를 넣은 경우가 여기 걸린다(막을 이유는 없고 업로드만 아끼면 된다).
      const dedupKey = `${usage}:${imageKey}`;
      if (seen.has(dedupKey)) return;
      seen.add(dedupKey);
      refs.push({ imageKey, usage, sourceUrl });
    };

    if (thumbnail !== '') add(thumbnail, 'main');
    for (const key of additional) add(key, 'main');
    for (const key of description) add(key, 'description');

    record.imageRefs = refs;
  }

  /**
   * Categories 시트로 다중 카테고리를 지정한다.
   *
   * `Products.categoryPath` 는 기존 워크북 하위호환으로 남아 있고, **같은 상품에 둘 다
   * 있으면 행 오류**다. 조용히 한쪽을 이기게 하면 MD 가 채운 카테고리가 말없이 사라지는데,
   * 카테고리는 노출 위치를 결정하므로 그 실수는 게시 후에나 발견된다.
   */
  private applyCategorySheet(
    rows: RawRow[],
    records: ProductRecord[],
    byKey: Map<string, ProductRecord>,
    bySlug: Map<string, CategoryNode>,
    byParent: Map<string | null, CategoryNode[]>,
    byId: Map<string, CategoryNode>,
  ): void {
    if (rows.length === 0) return;

    // 상품 단위로 모은다 — isPrimary "정확히 1개" 는 행 하나만 봐서는 판정할 수 없다.
    const grouped = new Map<string, RawRow[]>();
    for (const row of rows) {
      const productKey = row.cells.productKey ?? '';
      if (!byKey.has(productKey)) {
        records.push(this.orphanRecord('Categories', row));
        continue;
      }
      const list = grouped.get(productKey) ?? [];
      list.push(row);
      grouped.set(productKey, list);
    }

    for (const [productKey, sheetRows] of grouped) {
      const target = byKey.get(productKey);
      if (!target) continue; // grouped 에는 byKey.has 를 통과한 키만 들어온다
      const push = (row: RawRow, message: string) =>
        target.errors.push({ sheet: 'Categories', rowNumber: row.rowNumber, message });

      if ((target.raw.categoryPath ?? '').trim() !== '') {
        push(sheetRows[0], 'Products.categoryPath 와 Categories 시트를 동시에 쓸 수 없습니다. 한쪽만 채워주세요.');
        continue;
      }

      const ids: string[] = [];
      const seen = new Set<string>();
      const primaries: string[] = [];
      let primaryNames: string[] = [];
      let valid = true;

      for (const row of sheetRows) {
        const path = (row.cells.categoryPath ?? '').trim();
        if (path === '') {
          push(row, 'categoryPath 는 필수입니다.');
          valid = false;
          continue;
        }
        const resolved = this.resolveCategory(path, bySlug, byParent, byId);
        if (!resolved) {
          push(row, `${UNRESOLVABLE_CATEGORY_PATH}: ${path}`);
          valid = false;
          continue;
        }
        if (seen.has(resolved.id)) {
          push(row, `같은 카테고리가 중복 지정되었습니다: ${path}`);
          valid = false;
          continue;
        }
        seen.add(resolved.id);
        ids.push(resolved.id);
        if (parseBoolCell(row.cells.isPrimary)) {
          primaries.push(resolved.id);
          primaryNames = resolved.names;
        }
      }

      // 경로가 안 풀린 상태에서 개수까지 세면 "isPrimary 가 0개다"가 함께 나와 원인이
      // 흐려진다 — 해석이 전부 성공했을 때만 개수를 본다.
      if (valid && primaries.length !== 1) {
        push(sheetRows[0], `isPrimary 는 상품당 정확히 1개여야 합니다 (현재 ${primaries.length}개).`);
        valid = false;
      }
      if (!valid) continue;

      target.categoryIds = ids;
      target.primaryCategoryId = primaries[0];
      target.categoryNames = primaryNames;
    }
  }

  /**
   * Constraints 시트를 상품에 접합한다. 숫자 파싱은 하지 않는다 — 오류 메시지를 한 곳에
   * 모으기 위해 validator 가 한다(Variants 오버라이드 가격과 같은 분담).
   */
  private applyConstraintSheet(rows: RawRow[], records: ProductRecord[], byKey: Map<string, ProductRecord>): void {
    const seenKeys = new Set<string>();

    for (const row of rows) {
      const productKey = row.cells.productKey ?? '';
      const target = byKey.get(productKey);

      if (!target) {
        records.push(this.orphanRecord('Constraints', row));
        continue;
      }

      if (seenKeys.has(productKey)) {
        // 나중 행이 조용히 앞 행을 덮으면 어느 쪽이 적용됐는지 파일만 봐서는 알 수 없다.
        target.errors.push({
          sheet: 'Constraints',
          rowNumber: row.rowNumber,
          message: `구매제약은 상품당 한 행만 쓸 수 있습니다: ${productKey}`,
        });
        continue;
      }
      seenKeys.add(productKey);

      target.purchaseConstraintRaw = {
        rowNumber: row.rowNumber,
        requiresMembershipRaw: (row.cells.requiresMembership ?? '').trim(),
        lifetimeQuantityLimitRaw: (row.cells.lifetimeQuantityLimit ?? '').trim(),
      };
    }
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
