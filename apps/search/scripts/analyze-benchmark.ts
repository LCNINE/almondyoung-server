#!/usr/bin/env ts-node

/**
 * 벤치마크 CSV 분석 스크립트
 *
 * CSV 형식: keyword,total,rank1,rank2,rank3,rank10,rank20
 *
 * Usage:
 *   ts-node apps/search/scripts/analyze-benchmark.ts <csv-file> [options]
 *
 * Options:
 *   --top=N          상위 N개 항목 출력 (기본값: 20)
 *   --output-dir=D   상세 목록 파일 저장 디렉터리 (기본값: CSV 파일과 같은 위치)
 *   --no-files       파일 저장 없이 stdout만 출력
 */

import * as fs from 'fs';
import * as path from 'path';

// ─── 타입 ───────────────────────────────────────────────────────────────────

type Row = {
  keyword: string;
  total: number | 'ERROR';
  rank1: string;
  rank2: string;
  rank3: string;
  rank10: string;
  rank20: string;
};

type AnalyzeOptions = {
  csvFile: string;
  top: number;
  outputDir: string | null;
  noFiles: boolean;
};

// ─── CLI ────────────────────────────────────────────────────────────────────

function parseArgs(): AnalyzeOptions {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.length === 0) {
    printUsage();
    process.exit(0);
  }

  const positional = args.filter((a) => !a.startsWith('--'));
  if (positional.length === 0) {
    console.error('Error: <csv-file> is required');
    printUsage();
    process.exit(1);
  }

  const csvFile = positional[0];

  const getOption = (name: string): string | undefined => {
    const found = args.find((a) => a.startsWith(`${name}=`));
    return found ? found.substring(name.length + 1) : undefined;
  };

  const topRaw = getOption('--top');
  const top = topRaw !== undefined ? Math.max(1, parseInt(topRaw, 10)) : 20;

  const outputDirRaw = getOption('--output-dir');
  const noFiles = args.includes('--no-files');

  return {
    csvFile: path.resolve(csvFile),
    top,
    outputDir: noFiles ? null : outputDirRaw ? path.resolve(outputDirRaw) : null,
    noFiles,
  };
}

function printUsage(): void {
  console.log(
    [
      'Usage:',
      '  ts-node apps/search/scripts/analyze-benchmark.ts <csv-file> [options]',
      '',
      'Arguments:',
      '  <csv-file>         벤치마크 CSV 파일 경로 (필수)',
      '',
      'Options:',
      '  --top=N            상위 N개 항목 출력 (기본값: 20)',
      '  --output-dir=D     상세 목록 저장 디렉터리 (기본값: CSV 파일과 같은 위치)',
      '  --no-files         파일 저장 없이 stdout만 출력',
      '  --help             도움말 출력',
    ].join('\n'),
  );
}

// ─── CSV 파서 ────────────────────────────────────────────────────────────────

/**
 * RFC 4180 준수 CSV 파서.
 * 쌍따옴표로 감싼 필드 내 줄바꿈/쉼표/따옴표를 처리한다.
 */
function parseCSV(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < content.length) {
    const ch = content[i];

    if (inQuotes) {
      if (ch === '"') {
        if (content[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        field += ch;
        i++;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        i++;
      } else if (ch === ',') {
        row.push(field);
        field = '';
        i++;
      } else if (ch === '\r' && content[i + 1] === '\n') {
        row.push(field);
        field = '';
        rows.push(row);
        row = [];
        i += 2;
      } else if (ch === '\n') {
        row.push(field);
        field = '';
        rows.push(row);
        row = [];
        i++;
      } else {
        field += ch;
        i++;
      }
    }
  }

  // 마지막 필드/행 처리
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function loadRows(csvFile: string): Row[] {
  if (!fs.existsSync(csvFile)) {
    throw new Error(`파일을 찾을 수 없습니다: ${csvFile}`);
  }

  const content = fs.readFileSync(csvFile, 'utf-8');
  const parsed = parseCSV(content);

  if (parsed.length === 0) {
    return [];
  }

  // 헤더 검증
  const header = parsed[0];
  const expectedHeader = ['keyword', 'total', 'rank1', 'rank2', 'rank3', 'rank10', 'rank20'];
  if (!expectedHeader.every((col, i) => header[i] === col)) {
    throw new Error(`예상하지 못한 CSV 헤더입니다.\n  예상: ${expectedHeader.join(',')}\n  실제: ${header.join(',')}`);
  }

  const rows: Row[] = [];
  for (let i = 1; i < parsed.length; i++) {
    const cols = parsed[i];
    if (cols.length < 7) continue;

    const keyword = cols[0];
    if (keyword.length === 0) continue;

    const totalRaw = cols[1];
    const total: number | 'ERROR' = totalRaw === 'ERROR' ? 'ERROR' : parseInt(totalRaw, 10);

    rows.push({
      keyword,
      total,
      rank1: cols[2] ?? '',
      rank2: cols[3] ?? '',
      rank3: cols[4] ?? '',
      rank10: cols[5] ?? '',
      rank20: cols[6] ?? '',
    });
  }

  return rows;
}

// ─── 분석 ────────────────────────────────────────────────────────────────────

type Bucket = {
  label: string;
  min: number;
  max: number; // inclusive, Infinity for unbounded
};

const BUCKETS: Bucket[] = [
  { label: '0', min: 0, max: 0 },
  { label: '1', min: 1, max: 1 },
  { label: '2–5', min: 2, max: 5 },
  { label: '6–10', min: 6, max: 10 },
  { label: '11–20', min: 11, max: 20 },
  { label: '21–50', min: 21, max: 50 },
  { label: '51–100', min: 51, max: 100 },
  { label: '101–500', min: 101, max: 500 },
  { label: '501+', min: 501, max: Infinity },
];

function bucketFor(total: number): Bucket {
  return BUCKETS.find((b) => total >= b.min && total <= b.max) ?? BUCKETS[BUCKETS.length - 1];
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

function analyze(rows: Row[], top: number) {
  const errors = rows.filter((r) => r.total === 'ERROR');
  const valid = rows.filter((r) => r.total !== 'ERROR') as (Row & { total: number })[];

  const zeroResults = valid.filter((r) => r.total === 0);
  const nonZero = valid.filter((r) => r.total > 0);

  // 결과 수 분포 (버킷)
  const bucketCounts = new Map<string, number>();
  for (const b of BUCKETS) bucketCounts.set(b.label, 0);
  for (const r of valid) {
    const b = bucketFor(r.total);
    bucketCounts.set(b.label, (bucketCounts.get(b.label) ?? 0) + 1);
  }

  // 백분위 통계
  const totals = valid.map((r) => r.total).sort((a, b) => a - b);
  const mean = totals.length > 0 ? totals.reduce((s, v) => s + v, 0) / totals.length : 0;

  // rank1 빈도 (검색 노출 독점도)
  const rank1Freq = new Map<string, number>();
  for (const r of nonZero) {
    if (r.rank1.length > 0) {
      rank1Freq.set(r.rank1, (rank1Freq.get(r.rank1) ?? 0) + 1);
    }
  }
  const topRank1 = [...rank1Freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, top);

  // rank1 누락: total > 0인데 rank1이 비어있는 것 (데이터 이상)
  const rank1Missing = nonZero.filter((r) => r.rank1.length === 0);

  // total=1 인 것 (유일 결과)
  const singleResult = valid.filter((r) => r.total === 1);

  // 가장 많은 결과 (long-tail 반대)
  const topByTotal = [...valid].sort((a, b) => b.total - a.total).slice(0, top);

  return {
    totalRows: rows.length,
    errors,
    valid,
    zeroResults,
    singleResult,
    nonZero,
    bucketCounts,
    totals,
    mean,
    percentiles: {
      p25: percentile(totals, 25),
      p50: percentile(totals, 50),
      p75: percentile(totals, 75),
      p90: percentile(totals, 90),
      p95: percentile(totals, 95),
      p99: percentile(totals, 99),
    },
    topRank1,
    rank1Missing,
    topByTotal,
  };
}

// ─── 출력 ────────────────────────────────────────────────────────────────────

function pct(count: number, total: number): string {
  if (total === 0) return '0.0%';
  return `${((count / total) * 100).toFixed(1)}%`;
}

function hr(char = '─', width = 60): string {
  return char.repeat(width);
}

function printReport(stats: ReturnType<typeof analyze>, csvFile: string): void {
  const {
    totalRows,
    errors,
    valid,
    zeroResults,
    singleResult,
    nonZero,
    bucketCounts,
    mean,
    percentiles,
    topRank1,
    rank1Missing,
    topByTotal,
  } = stats;

  console.log();
  console.log(hr('═'));
  console.log('  검색 벤치마크 분석 결과');
  console.log(`  파일: ${csvFile}`);
  console.log(hr('═'));

  // ── 요약 ──
  console.log();
  console.log('[ 요약 ]');
  console.log(hr());
  console.log(`  전체 키워드:        ${totalRows.toLocaleString()}`);
  console.log(`  오류(ERROR):        ${errors.length.toLocaleString()}  (${pct(errors.length, totalRows)})`);
  console.log(`  유효 키워드:        ${valid.length.toLocaleString()}  (${pct(valid.length, totalRows)})`);
  console.log(
    `  검색결과 없음(0):   ${zeroResults.length.toLocaleString()}  (${pct(zeroResults.length, valid.length)} of valid)`,
  );
  console.log(
    `  결과 1개(단일):     ${singleResult.length.toLocaleString()}  (${pct(singleResult.length, valid.length)} of valid)`,
  );
  console.log(
    `  결과 있음:          ${nonZero.length.toLocaleString()}  (${pct(nonZero.length, valid.length)} of valid)`,
  );

  // ── 결과 수 분포 ──
  console.log();
  console.log('[ 결과 수 분포 ]');
  console.log(hr());
  const maxCount = Math.max(...bucketCounts.values());
  const barWidth = 30;
  for (const b of BUCKETS) {
    const count = bucketCounts.get(b.label) ?? 0;
    const bar = '█'.repeat(Math.round((count / Math.max(maxCount, 1)) * barWidth));
    const label = b.label.padStart(7);
    const countStr = count.toLocaleString().padStart(7);
    const pctStr = pct(count, valid.length).padStart(6);
    console.log(`  ${label}  ${countStr} ${pctStr}  ${bar}`);
  }

  // ── 백분위 통계 ──
  console.log();
  console.log('[ 결과 수 백분위 (유효 키워드 기준) ]');
  console.log(hr());
  console.log(`  평균(mean):  ${mean.toFixed(1)}`);
  console.log(`  중앙값(p50): ${percentiles.p50}`);
  console.log(
    `  p25: ${percentiles.p25}   p75: ${percentiles.p75}   p90: ${percentiles.p90}   p95: ${percentiles.p95}   p99: ${percentiles.p99}`,
  );

  // ── rank1 노출 빈도 Top N ──
  console.log();
  console.log(`[ rank1 상품 노출 빈도 Top ${topRank1.length} ]`);
  console.log(hr());
  if (topRank1.length === 0) {
    console.log('  (데이터 없음)');
  } else {
    for (let i = 0; i < topRank1.length; i++) {
      const [name, count] = topRank1[i];
      const pctStr = pct(count, nonZero.length);
      console.log(
        `  ${String(i + 1).padStart(3)}. [${count.toString().padStart(5)}건 / ${pctStr.padStart(6)}]  ${name}`,
      );
    }
  }

  // ── rank1 누락 경고 ──
  if (rank1Missing.length > 0) {
    console.log();
    console.log(`[ ⚠ rank1 누락 (total>0 이지만 rank1 비어있음): ${rank1Missing.length}건 ]`);
    console.log(hr());
    for (const r of rank1Missing.slice(0, 10)) {
      console.log(`  "${r.keyword}"  →  total=${r.total}`);
    }
    if (rank1Missing.length > 10) {
      console.log(`  ... 외 ${rank1Missing.length - 10}건`);
    }
  }

  // ── 결과 많은 키워드 Top N ──
  console.log();
  console.log(`[ 검색결과 많은 키워드 Top ${topByTotal.length} ]`);
  console.log(hr());
  for (const r of topByTotal) {
    console.log(`  ${r.total.toLocaleString().padStart(7)}건  "${r.keyword}"`);
  }

  console.log();
  console.log(hr('═'));
}

function writeFile(outputDir: string, filename: string, lines: string[]): void {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const filepath = path.join(outputDir, filename);
  fs.writeFileSync(filepath, lines.join('\n') + '\n', 'utf-8');
  console.log(`  저장됨: ${filepath}`);
}

function writeDetailFiles(stats: ReturnType<typeof analyze>, outputDir: string, csvFile: string): void {
  const base = path.basename(csvFile, path.extname(csvFile));

  console.log();
  console.log('[ 상세 목록 파일 저장 ]');
  console.log(hr());

  // 검색결과 없는 키워드
  if (stats.zeroResults.length > 0) {
    writeFile(
      outputDir,
      `${base}-zero-results.txt`,
      stats.zeroResults.map((r) => r.keyword),
    );
  }

  // ERROR 키워드
  if (stats.errors.length > 0) {
    writeFile(
      outputDir,
      `${base}-errors.txt`,
      stats.errors.map((r) => r.keyword),
    );
  }

  // 결과 1개 키워드
  if (stats.singleResult.length > 0) {
    writeFile(
      outputDir,
      `${base}-single-result.txt`,
      stats.singleResult.map((r) => r.keyword),
    );
  }

  // rank1 누락
  if (stats.rank1Missing.length > 0) {
    writeFile(
      outputDir,
      `${base}-rank1-missing.txt`,
      stats.rank1Missing.map((r) => `${r.keyword}\t(total=${r.total})`),
    );
  }

  // 전체 요약 CSV (keyword, total 만)
  const summaryLines = [
    'keyword,total',
    ...stats.valid
      .slice()
      .sort((a, b) => a.total - b.total)
      .map((r) => `${escapeCsvField(r.keyword)},${r.total}`),
  ];
  writeFile(outputDir, `${base}-sorted-by-total.csv`, summaryLines);
}

function escapeCsvField(value: string): string {
  if (/[,"\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  const options = parseArgs();

  console.log(`CSV 로딩 중: ${options.csvFile}`);
  const rows = loadRows(options.csvFile);
  console.log(`→ ${rows.length.toLocaleString()}행 로드 완료`);

  const stats = analyze(rows, options.top);

  printReport(stats, options.csvFile);

  if (!options.noFiles) {
    const outputDir = options.outputDir ?? path.dirname(options.csvFile);
    writeDetailFiles(stats, outputDir, options.csvFile);
  }
}

main().catch((err) => {
  console.error('분석 실패:', err.message ?? err);
  process.exit(1);
});
