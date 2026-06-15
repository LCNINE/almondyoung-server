/**
 * 셀메이트 엑셀 파싱 공용 모듈 (import-products.ts / sync-stock.ts 공용)
 *
 * 셀메이트 "엑셀 다운로드"는 확장자가 .xls 지만 실제로는 다음 셋 중 하나다:
 *   1) HTML <table> + EUC-KR(cp949)  ← 셀메이트 기본 (가장 흔함)
 *   2) 진짜 xlsx (zip, PK 시그니처)
 *   3) 구형 OLE2 .xls (D0CF11E0)     ← 이건 못 읽음 → CSV 재저장 안내
 * 이 모듈이 셋을 자동 판별해 string[][] 로 돌려준다.
 */
import * as fs from 'fs';
import * as path from 'path';
import iconv from 'iconv-lite';
import Papa from 'papaparse';
import ExcelJS from 'exceljs';

// 셀메이트 HTML-xls 기본 인코딩. UTF-8 로 저장된 파일이면 SELLMATE_ENCODING=utf-8 로 덮어쓰기.
const SELLMATE_ENCODING = process.env.SELLMATE_ENCODING || 'euc-kr';

// ── 헤더 정규화: 공백/괄호/언더바/구분자/대소문자 무시 ──────────────────────────
export function norm(s: string): string {
  return s
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[\s()_\-./[\]]/g, '');
}

// ── HTML 셀 → 순수 텍스트 (태그 제거 + 엔티티 복원) ────────────────────────────
function stripCell(html: string): string {
  return html
    .replace(/<[^>]*>/g, '') // 태그 제거 (img 등 → 빈 문자열)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .trim();
}

// ── exceljs 셀값 → 문자열 ───────────────────────────────────────────────────────
// CellValue 는 string/number/boolean/Date 외에 rich-text·hyperlink·formula 객체가 올 수 있다.
// 객체를 그냥 String() 하면 "[object Object]" 가 되므로 알려진 형태만 텍스트로 환원한다.
function cellToString(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.text === 'string') return o.text; // hyperlink / rich text
    if (Array.isArray(o.richText)) return o.richText.map((r) => cellToString(r)).join('');
    if ('result' in o) return cellToString(o.result); // formula
    return '';
  }
  return '';
}

function parseHtmlTable(text: string): string[][] {
  const rows: string[][] = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let tr: RegExpExecArray | null;
  while ((tr = trRe.exec(text))) {
    const tdRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    const cells: string[] = [];
    let td: RegExpExecArray | null;
    while ((td = tdRe.exec(tr[1]))) cells.push(stripCell(td[1]));
    if (cells.length) rows.push(cells);
  }
  return rows;
}

// ── 파일 → 2차원 배열 ──────────────────────────────────────────────────────────
export async function readRows(file: string): Promise<string[][]> {
  const ext = path.extname(file).toLowerCase();
  const buf = fs.readFileSync(file);

  if (ext === '.csv') {
    // CSV 는 utf-8 가정, 깨지면 euc-kr 재시도
    let text = buf.toString('utf-8');
    if (text.includes('�')) text = iconv.decode(buf, SELLMATE_ENCODING);
    return Papa.parse<string[]>(text, { skipEmptyLines: true }).data;
  }

  // 시그니처로 실제 포맷 판별
  const isOle2 = buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0;
  const isZip = buf[0] === 0x50 && buf[1] === 0x4b; // PK → xlsx

  if (isZip) {
    const wb = new ExcelJS.Workbook();
    // fs.readFileSync 의 Buffer 와 exceljs load() 파라미터 Buffer 가 제네릭 불변성으로 안 맞아
    // 파라미터 타입에 정확히 맞춰 캐스팅. 런타임 표현은 동일한 Node Buffer 라 안전하다.
    await wb.xlsx.load(buf as unknown as Parameters<typeof wb.xlsx.load>[0]);
    const ws = wb.worksheets[0];
    const rows: string[][] = [];
    ws.eachRow((row) => {
      const vals = (row.values as unknown[]).slice(1); // exceljs 1-base
      rows.push(vals.map(cellToString));
    });
    return rows;
  }

  if (isOle2) {
    throw new Error(
      `구형 OLE2 .xls 라 못 읽습니다: ${path.basename(file)}\n` +
        `→ Excel/Numbers 로 열어 "CSV(UTF-8)" 또는 ".xlsx" 로 다시 저장해 주세요.`,
    );
  }

  // 그 외 = 셀메이트 HTML <table> (EUC-KR). 디코딩 후 테이블 파싱.
  const text = iconv.decode(buf, SELLMATE_ENCODING);
  const rows = parseHtmlTable(text);
  if (rows.length === 0) {
    throw new Error(`테이블을 못 찾았습니다: ${path.basename(file)} (인코딩 문제면 SELLMATE_ENCODING 지정)`);
  }
  return rows;
}

// ── 헤더 행에서 각 논리필드의 열 인덱스 탐지 ───────────────────────────────────
// candidates: { 논리필드: [헤더후보...] }, overrides: { 논리필드: 강제헤더이름 }
export function detectColumns<F extends string>(
  header: string[],
  candidates: Record<F, readonly string[]>,
  overrides: Partial<Record<F, string | undefined>> = {},
): Record<F, number> {
  const normedHeader = header.map(norm);
  const result = {} as Record<F, number>;
  for (const field of Object.keys(candidates) as F[]) {
    const override = overrides[field];
    if (override) {
      result[field] = normedHeader.indexOf(norm(override));
      continue;
    }
    let found = -1;
    for (const cand of candidates[field]) {
      const idx = normedHeader.indexOf(norm(cand));
      if (idx !== -1) {
        found = idx;
        break;
      }
    }
    result[field] = found;
  }
  return result;
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
