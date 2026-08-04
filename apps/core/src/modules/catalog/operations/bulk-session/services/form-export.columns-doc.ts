import { ALL_COLUMN_SETS, PRICING_SENTINEL, SHEET_NAMES } from './form-export.sheets';

/**
 * 스킬이 읽는 열 레퍼런스를 `ALL_COLUMN_SETS` 에서 **생성**한다.
 *
 * 손으로 베낀 표를 스킬에 두면 열이 추가될 때 조용히 어긋나고, 어긋나도 아무 경고 없이
 * 잘못된 양식이 만들어진다. 생성기 + 동기화 테스트가 그 드리프트를 0으로 만든다.
 *
 * 마크다운은 AI 가 읽고, JSON 은 스크립트가 읽는다 — 같은 출처에서 나오므로 둘이 갈릴 수 없다.
 */
export function buildColumnsMarkdown(): string {
  const lines: string[] = [
    '# 워크북 열 레퍼런스',
    '',
    '> 이 파일은 `form-export.sheets.ts` 의 `ALL_COLUMN_SETS` 에서 생성된다. 직접 고치지 마라 —',
    '> `npx ts-node scripts/generate-bulk-form-columns.ts` 로 다시 만든다.',
    '',
    '**볼드가 필수 열이다.** 파서는 헤더 *이름*으로 열을 찾으므로 열 순서는 자유이고, 모르는 열은 무시한다.',
    '',
  ];

  for (const set of ALL_COLUMN_SETS) {
    lines.push(`## ${set.name}`, '', '| 열 | 내부 키 | 필수 |', '|---|---|---|');
    for (const col of set.columns) {
      const label = col.required ? `**${col.label}**` : col.label;
      lines.push(`| ${label} | \`${col.key}\` | ${col.required ? 'O' : ''} |`);
    }
    lines.push('');
  }

  lines.push(
    '## 시트 이름',
    '',
    ...Object.values(SHEET_NAMES).map((name) => `- \`${name}\``),
    '',
    '## 상수',
    '',
    `- 복합 가격규칙 센티넬: \`${PRICING_SENTINEL}\``,
    '',
  );

  return lines.join('\n');
}

export function buildColumnsJson(): string {
  const sheets: Record<string, Array<{ key: string; label: string; required: boolean }>> = {};
  for (const set of ALL_COLUMN_SETS) {
    sheets[set.name] = set.columns.map((col) => ({ key: col.key, label: col.label, required: col.required }));
  }
  return `${JSON.stringify({ sheetNames: SHEET_NAMES, pricingSentinel: PRICING_SENTINEL, sheets }, null, 2)}\n`;
}
