import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildColumnsJson, buildColumnsMarkdown } from './form-export.columns-doc';
import { ALL_COLUMN_SETS, VARIANT_COLUMNS } from './form-export.sheets';

const SKILL_ROOT = join(__dirname, '../../../../../../../../skills/product-bulk-form');

describe('열 레퍼런스 생성기', () => {
  it('모든 시트와 모든 열 라벨이 마크다운에 들어간다', () => {
    const md = buildColumnsMarkdown();
    for (const set of ALL_COLUMN_SETS) {
      expect(md).toContain(set.name);
      for (const col of set.columns) expect(md).toContain(col.label);
    }
  });

  it('JSON 은 라벨↔키 매핑을 시트별로 담는다', () => {
    const parsed = JSON.parse(buildColumnsJson()) as {
      sheets: Record<string, Array<{ key: string; label: string; required: boolean; note: string | null }>>;
    };
    expect(Object.keys(parsed.sheets)).toEqual(ALL_COLUMN_SETS.map((s) => s.name));
    expect(parsed.sheets['상품']).toContainEqual({ key: 'rowKey', label: '상품키', required: true, note: null });
  });

  it('조합 시트에 판매정책 열 4종이 있고 각각 설명을 갖는다', () => {
    const keys = VARIANT_COLUMNS.map((c) => c.key);
    expect(keys).toEqual(
      expect.arrayContaining(['availabilityOverride', 'comingSoonDate', 'preStockSellable', 'alwaysSellableZeroStock']),
    );
    for (const key of ['availabilityOverride', 'comingSoonDate', 'preStockSellable', 'alwaysSellableZeroStock']) {
      const col = VARIANT_COLUMNS.find((c) => c.key === key);
      expect(col?.required).toBe(false);
      // 허용값과 빈칸 의미가 스킬 문서에 실려야 한다 — 열 이름만으로는 '품절'/'출시예정' 을 알 수 없다.
      expect(col?.note ?? '').not.toBe('');
    }
  });

  it('생성된 마크다운이 열 설명을 싣는다', () => {
    const md = buildColumnsMarkdown();
    expect(md).toContain('판매상태재정의');
    expect(md).toContain('품절');
    expect(md).toContain('출시예정');
  });
});

describe('커밋된 스킬 파일이 코드와 동기화돼 있다', () => {
  // 이 두 테스트가 깨졌다는 것은 열이 바뀌었는데 스킬이 안 따라왔다는 뜻이다.
  // 고치는 방법: `npx ts-node scripts/generate-bulk-form-columns.ts`
  it('references/columns.md', () => {
    expect(readFileSync(join(SKILL_ROOT, 'references/columns.md'), 'utf8')).toBe(buildColumnsMarkdown());
  });

  it('scripts/columns.json', () => {
    expect(readFileSync(join(SKILL_ROOT, 'scripts/columns.json'), 'utf8')).toBe(buildColumnsJson());
  });
});
