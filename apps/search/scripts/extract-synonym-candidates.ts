#!/usr/bin/env ts-node

import * as fs from 'fs';
import * as path from 'path';

type BenchmarkRow = {
  keyword: string;
  total: number | 'ERROR';
  rank1: string;
  rank2: string;
  rank3: string;
  rank10: string;
  rank20: string;
};

type Candidate = {
  candidateKeyword: string;
  candidateTotal: number;
  candidateRank1: string;
  similarity: number;
  score: number;
  reason: string;
};

type ExtractOptions = {
  benchmarkFile: string;
  zeroFile: string | null;
  outputFile: string;
  sourceMode: 'zero' | 'low';
  lowThreshold: number;
  minCandidateTotal: number;
  minScore: number;
  top: number;
  maxEditDistance: number;
};

function parseArgs(): ExtractOptions {
  const args = process.argv.slice(2);

  if (args.includes('--help')) {
    printUsage();
    process.exit(0);
  }

  const positional = args.filter((arg) => !arg.startsWith('--'));
  const benchmarkFile = path.resolve(
    positional[0] ?? 'apps/search/benchmark-results-3.csv',
  );

  const getOption = (name: string): string | undefined => {
    const found = args.find((arg) => arg.startsWith(`${name}=`));
    return found ? found.slice(name.length + 1) : undefined;
  };

  const parsePositiveInt = (
    raw: string | undefined,
    name: string,
    defaultValue: number,
  ): number => {
    if (raw === undefined) return defaultValue;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new Error(`${name} must be a positive integer`);
    }
    return parsed;
  };

  const parseNonNegativeInt = (
    raw: string | undefined,
    name: string,
    defaultValue: number,
  ): number => {
    if (raw === undefined) return defaultValue;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new Error(`${name} must be a non-negative integer`);
    }
    return parsed;
  };

  const parseUnitFloat = (
    raw: string | undefined,
    name: string,
    defaultValue: number,
  ): number => {
    if (raw === undefined) return defaultValue;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
      throw new Error(`${name} must be a number between 0 and 1`);
    }
    return parsed;
  };

  const sourceModeRaw = getOption('--source') ?? 'zero';
  if (sourceModeRaw !== 'zero' && sourceModeRaw !== 'low') {
    throw new Error('--source must be one of: zero, low');
  }

  const zeroFileRaw = getOption('--zero-file');
  const zeroFile = resolveZeroFile(benchmarkFile, zeroFileRaw);

  const outputFile = path.resolve(
    getOption('--output-file') ??
      benchmarkFile.replace(/\.csv$/i, '-synonym-candidates.csv'),
  );

  return {
    benchmarkFile,
    zeroFile,
    outputFile,
    sourceMode: sourceModeRaw,
    lowThreshold: parseNonNegativeInt(
      getOption('--low-threshold'),
      '--low-threshold',
      2,
    ),
    minCandidateTotal: parsePositiveInt(
      getOption('--min-candidate-total'),
      '--min-candidate-total',
      3,
    ),
    minScore: parseUnitFloat(getOption('--min-score'), '--min-score', 0.72),
    top: parsePositiveInt(getOption('--top'), '--top', 3),
    maxEditDistance: parsePositiveInt(
      getOption('--max-edit-distance'),
      '--max-edit-distance',
      2,
    ),
  };
}

function printUsage(): void {
  console.log(
    [
      'Usage:',
      '  npm run search:synonym-candidates -- [benchmark-file] [options]',
      '',
      'Arguments:',
      '  [benchmark-file]             Benchmark CSV path (default: apps/search/benchmark-results-3.csv)',
      '',
      'Options:',
      '  --zero-file=<path>           Zero-result keyword list (default: inferred from benchmark file)',
      '  --output-file=<path>         Output CSV path (default: <benchmark>-synonym-candidates.csv)',
      '  --source=zero|low            Source keyword mode (default: zero)',
      '  --low-threshold=<n>          Max total for low mode (default: 2)',
      '  --min-candidate-total=<n>    Minimum total for candidate keywords (default: 3)',
      '  --min-score=<0..1>           Minimum candidate score (default: 0.72)',
      '  --top=<n>                    Max candidates per source keyword (default: 3)',
      '  --max-edit-distance=<n>      Base max edit distance (default: 2)',
      '  --help                       Show this help',
      '',
      'Output columns:',
      '  source_keyword,source_total,candidate_rank,candidate_keyword,candidate_total,similarity,score,reason,candidate_rank1,suggested_rule',
    ].join('\n'),
  );
}

function resolveZeroFile(
  benchmarkFile: string,
  explicit: string | undefined,
): string | null {
  if (explicit !== undefined) {
    const resolved = path.resolve(explicit);
    return fs.existsSync(resolved) ? resolved : null;
  }

  const inferred = benchmarkFile.replace(/\.csv$/i, '-zero-results.txt');
  return fs.existsSync(inferred) ? inferred : null;
}

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

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function parseBenchmarkRows(csvFile: string): BenchmarkRow[] {
  if (!fs.existsSync(csvFile)) {
    throw new Error(`Benchmark CSV not found: ${csvFile}`);
  }

  const content = fs.readFileSync(csvFile, 'utf-8');
  const parsed = parseCSV(content);

  if (parsed.length === 0) {
    return [];
  }

  const header = parsed[0] ?? [];
  const expected = [
    'keyword',
    'total',
    'rank1',
    'rank2',
    'rank3',
    'rank10',
    'rank20',
  ];
  if (!expected.every((value, idx) => header[idx] === value)) {
    throw new Error(
      `Unexpected benchmark header. expected=${expected.join(',')} actual=${header.join(',')}`,
    );
  }

  const rows: BenchmarkRow[] = [];

  for (let i = 1; i < parsed.length; i++) {
    const cols = parsed[i];
    if (!cols || cols.length < 2) continue;

    const keyword = (cols[0] ?? '').trim();
    if (!keyword) continue;

    const rawTotal = (cols[1] ?? '').trim();
    const total: number | 'ERROR' =
      rawTotal === 'ERROR' ? 'ERROR' : Number.isFinite(Number(rawTotal)) ? Number(rawTotal) : 'ERROR';

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

function loadZeroKeywords(filePath: string | null): string[] {
  if (!filePath || !fs.existsSync(filePath)) {
    return [];
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !/^\d+$/.test(line));
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function compact(value: string): string {
  return normalize(value).replace(/[^\p{L}\p{N}]+/gu, '');
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const prev: number[] = new Array(b.length + 1);
  const curr: number[] = new Array(b.length + 1);

  for (let j = 0; j <= b.length; j++) {
    prev[j] = j;
  }

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const deletion = prev[j] + 1;
      const insertion = curr[j - 1] + 1;
      const substitution = prev[j - 1] + cost;
      curr[j] = Math.min(deletion, insertion, substitution);
    }
    for (let j = 0; j <= b.length; j++) {
      prev[j] = curr[j];
    }
  }

  return prev[b.length];
}

function resolveAllowedDistance(
  maxLen: number,
  baseMaxEditDistance: number,
): number {
  if (maxLen <= 4) {
    return 1;
  }
  if (maxLen <= 8) {
    return Math.max(2, baseMaxEditDistance);
  }
  return Math.max(3, baseMaxEditDistance);
}

function calculateCandidate(
  sourceKeyword: string,
  candidateRow: BenchmarkRow & { total: number },
  options: ExtractOptions,
): Candidate | null {
  const sourceCompact = compact(sourceKeyword);
  const candidateCompact = compact(candidateRow.keyword);

  if (!sourceCompact || !candidateCompact) {
    return null;
  }

  if (sourceCompact.length <= 1 || candidateCompact.length <= 1) {
    return null;
  }

  if (sourceKeyword === candidateRow.keyword) {
    return null;
  }

  const reasons: string[] = [];
  let similarity = 0;
  let score = 0;

  if (sourceCompact === candidateCompact) {
    similarity = 1;
    score = 1;
    reasons.push('compact_exact');
  } else {
    const maxLen = Math.max(sourceCompact.length, candidateCompact.length);
    const distance = levenshteinDistance(sourceCompact, candidateCompact);
    const allowedDistance = resolveAllowedDistance(
      maxLen,
      options.maxEditDistance,
    );

    const contains =
      sourceCompact.includes(candidateCompact) ||
      candidateCompact.includes(sourceCompact);
    const prefix =
      sourceCompact.startsWith(candidateCompact) ||
      candidateCompact.startsWith(sourceCompact);

    if (distance > allowedDistance && !contains) {
      return null;
    }

    similarity = 1 - distance / maxLen;
    score = similarity;

    if (distance <= allowedDistance) {
      reasons.push(`edit_distance_${distance}`);
    }
    if (contains) {
      score += 0.08;
      reasons.push('contains');
    }
    if (prefix) {
      score += 0.04;
      reasons.push('prefix');
    }
  }

  const totalBoost = Math.min(Math.log10(candidateRow.total + 1) / 5, 0.15);
  score += totalBoost;
  reasons.push(`total_boost_${totalBoost.toFixed(2)}`);

  if (score < options.minScore) {
    return null;
  }

  return {
    candidateKeyword: candidateRow.keyword,
    candidateTotal: candidateRow.total,
    candidateRank1: candidateRow.rank1,
    similarity,
    score,
    reason: reasons.join('|'),
  };
}

function escapeCSV(value: string): string {
  if (/[,"\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function inferSourceKeywords(
  rows: BenchmarkRow[],
  zeroKeywords: string[],
  options: ExtractOptions,
): string[] {
  const set = new Set<string>();

  if (options.sourceMode === 'zero') {
    for (const keyword of zeroKeywords) {
      set.add(keyword);
    }
    for (const row of rows) {
      if (row.total === 0) {
        set.add(row.keyword);
      }
    }
  } else {
    for (const row of rows) {
      if (typeof row.total === 'number' && row.total <= options.lowThreshold) {
        set.add(row.keyword);
      }
    }
  }

  return Array.from(set);
}

function buildRowMap(rows: BenchmarkRow[]): Map<string, BenchmarkRow> {
  const map = new Map<string, BenchmarkRow>();
  for (const row of rows) {
    if (!map.has(row.keyword)) {
      map.set(row.keyword, row);
    }
  }
  return map;
}

function main(): void {
  const options = parseArgs();
  const rows = parseBenchmarkRows(options.benchmarkFile);
  const zeroKeywords = loadZeroKeywords(options.zeroFile);
  const sourceKeywords = inferSourceKeywords(rows, zeroKeywords, options);
  const rowMap = buildRowMap(rows);

  const candidateRows = rows.filter(
    (row): row is BenchmarkRow & { total: number } =>
      typeof row.total === 'number' && row.total >= options.minCandidateTotal,
  );

  const lines: string[] = [
    [
      'source_keyword',
      'source_total',
      'candidate_rank',
      'candidate_keyword',
      'candidate_total',
      'similarity',
      'score',
      'reason',
      'candidate_rank1',
      'suggested_rule',
    ].join(','),
  ];

  let sourceWithCandidates = 0;
  let emittedRows = 0;

  for (const sourceKeyword of sourceKeywords) {
    const sourceRow = rowMap.get(sourceKeyword);
    const sourceTotal =
      sourceRow && typeof sourceRow.total === 'number'
        ? sourceRow.total
        : sourceRow?.total === 'ERROR'
          ? 'ERROR'
          : '';

    const candidates = candidateRows
      .map((candidateRow) =>
        calculateCandidate(sourceKeyword, candidateRow, options),
      )
      .filter((candidate): candidate is Candidate => candidate !== null)
      .sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        if (b.candidateTotal !== a.candidateTotal) {
          return b.candidateTotal - a.candidateTotal;
        }
        return a.candidateKeyword.localeCompare(b.candidateKeyword);
      })
      .slice(0, options.top);

    if (candidates.length === 0) {
      continue;
    }

    sourceWithCandidates += 1;

    candidates.forEach((candidate, idx) => {
      const suggestedRule = `${sourceKeyword},${candidate.candidateKeyword}`;
      lines.push(
        [
          escapeCSV(sourceKeyword),
          String(sourceTotal),
          String(idx + 1),
          escapeCSV(candidate.candidateKeyword),
          String(candidate.candidateTotal),
          candidate.similarity.toFixed(4),
          candidate.score.toFixed(4),
          escapeCSV(candidate.reason),
          escapeCSV(candidate.candidateRank1),
          escapeCSV(suggestedRule),
        ].join(','),
      );
      emittedRows += 1;
    });
  }

  fs.mkdirSync(path.dirname(options.outputFile), { recursive: true });
  fs.writeFileSync(options.outputFile, lines.join('\n') + '\n', 'utf-8');

  console.log('Synonym candidate extraction complete');
  console.log(`- Benchmark file:         ${options.benchmarkFile}`);
  console.log(`- Zero file:              ${options.zeroFile ?? '(none)'}`);
  console.log(`- Source mode:            ${options.sourceMode}`);
  console.log(`- Source keywords:        ${sourceKeywords.length}`);
  console.log(`- Candidate keyword pool: ${candidateRows.length}`);
  console.log(`- Source with candidates: ${sourceWithCandidates}`);
  console.log(`- Emitted rows:           ${emittedRows}`);
  console.log(`- Output file:            ${options.outputFile}`);
}

main();
