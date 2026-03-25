#!/usr/bin/env ts-node

import * as fs from 'fs';
import * as path from 'path';

type BenchmarkOptions = {
  outputFile: string;
  baseUrl: string;
  concurrency: number;
  keywordsFile: string;
};

type SearchResult = {
  total: number;
  items: Array<{ name: string }>;
};

function parseArgs(): BenchmarkOptions {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.length === 0) {
    printUsage();
    process.exit(0);
  }

  const positional = args.filter((a) => !a.startsWith('--'));
  if (positional.length === 0) {
    console.error('Error: <output-file> is required');
    printUsage();
    process.exit(1);
  }

  const outputFile = positional[0];

  const getOption = (name: string): string | undefined => {
    const found = args.find((a) => a.startsWith(`${name}=`));
    return found ? found.substring(name.length + 1) : undefined;
  };

  const parsePositiveInt = (raw: string | undefined, name: string, defaultValue: number): number => {
    if (raw === undefined) return defaultValue;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new Error(`${name} must be a positive integer`);
    }
    return parsed;
  };

  return {
    outputFile,
    baseUrl: (getOption('--base-url') ?? 'http://localhost:3000').replace(/\/$/, ''),
    concurrency: parsePositiveInt(getOption('--concurrency'), '--concurrency', 5),
    keywordsFile: getOption('--keywords-file') ?? 'apps/search/test/test-keywords',
  };
}

function printUsage(): void {
  console.log(
    [
      'Usage:',
      '  npm run search:benchmark -- <output-file> [options]',
      '',
      'Arguments:',
      '  <output-file>              CSV output file path (required)',
      '',
      'Options:',
      '  --base-url=<url>           Search server URL (default: http://localhost:3004)',
      '  --concurrency=<n>          Concurrent requests (default: 5)',
      '  --keywords-file=<path>     Keywords file path (default: apps/search/test/test-keywords)',
      '  --help                     Show this help',
      '',
      'Resume support:',
      '  If <output-file> already exists, already-processed keywords are skipped.',
    ].join('\n'),
  );
}

function escapeCSV(value: string): string {
  if (/[,"\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function buildCSVLine(keyword: string, result: SearchResult | null): string {
  if (result === null) {
    const cols = [escapeCSV(keyword), 'ERROR', '', '', '', '', ''];
    return cols.join(',');
  }

  const getItemName = (index: number): string => {
    return result.items[index]?.name ?? '';
  };

  const cols = [
    escapeCSV(keyword),
    String(result.total),
    escapeCSV(getItemName(0)),
    escapeCSV(getItemName(1)),
    escapeCSV(getItemName(2)),
    escapeCSV(getItemName(9)),
    escapeCSV(getItemName(19)),
  ];
  return cols.join(',');
}

function readKeywords(filePath: string): string[] {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Keywords file not found: ${resolved}`);
  }
  const content = fs.readFileSync(resolved, 'utf-8');
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function getAlreadyProcessed(outputFile: string): Set<string> {
  const processed = new Set<string>();
  if (!fs.existsSync(outputFile)) {
    return processed;
  }

  const content = fs.readFileSync(outputFile, 'utf-8');
  const lines = content.split('\n');

  // Skip header (first line)
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.length === 0) continue;

    // Parse first column (keyword) respecting RFC 4180 quoting
    let keyword: string;
    if (line.startsWith('"')) {
      const closeQuote = line.indexOf('"', 1);
      if (closeQuote === -1) {
        keyword = line.slice(1);
      } else {
        keyword = line.slice(1, closeQuote).replace(/""/g, '"');
      }
    } else {
      const commaIdx = line.indexOf(',');
      keyword = commaIdx === -1 ? line : line.slice(0, commaIdx);
    }

    if (keyword.length > 0) {
      processed.add(keyword);
    }
  }

  return processed;
}

async function searchProducts(baseUrl: string, keyword: string): Promise<SearchResult> {
  const url = `${baseUrl}/search/products?q=${encodeURIComponent(keyword)}&size=20`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for keyword "${keyword}"`);
  }

  const data = await response.json();

  const total: number =
    typeof data?.pagination?.total === 'number'
      ? data.pagination.total
      : typeof data?.total === 'number'
        ? data.total
        : 0;

  const items: Array<{ name: string }> = Array.isArray(data?.items)
    ? data.items
    : Array.isArray(data?.data)
      ? data.data
      : [];

  return { total, items };
}

async function runWithConcurrency<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift()!;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

async function main() {
  const options = parseArgs();

  console.log('Search benchmark started');
  console.log(`- Output file:    ${options.outputFile}`);
  console.log(`- Base URL:       ${options.baseUrl}`);
  console.log(`- Concurrency:    ${options.concurrency}`);
  console.log(`- Keywords file:  ${options.keywordsFile}`);
  console.log();

  const keywords = readKeywords(options.keywordsFile);
  console.log(`Total keywords: ${keywords.length}`);

  const alreadyProcessed = getAlreadyProcessed(options.outputFile);
  if (alreadyProcessed.size > 0) {
    console.log(`Resuming: ${alreadyProcessed.size} already processed, skipping`);
  }

  const remaining = keywords.filter((k) => !alreadyProcessed.has(k));
  console.log(`Remaining: ${remaining.length}`);
  console.log();

  // Write header if file doesn't exist
  const fileExists = fs.existsSync(options.outputFile);
  if (!fileExists) {
    fs.writeFileSync(options.outputFile, 'keyword,total,rank1,rank2,rank3,rank10,rank20\n', 'utf-8');
  }

  const total = remaining.length;
  let done = 0;
  const startedAt = Date.now();
  let errors = 0;

  const appendStream = fs.createWriteStream(options.outputFile, { flags: 'a', encoding: 'utf-8' });

  await runWithConcurrency(remaining, options.concurrency, async (keyword) => {
    let result: SearchResult | null = null;
    try {
      result = await searchProducts(options.baseUrl, keyword);
    } catch (err) {
      errors += 1;
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`ERROR [${keyword}]: ${message}\n`);
    }

    const line = buildCSVLine(keyword, result);
    appendStream.write(line + '\n');

    done += 1;
    const label = result !== null ? `${result.total}개 결과` : 'ERROR';
    process.stdout.write(`[${done}/${total}] ${keyword} → ${label}\n`);
  });

  await new Promise<void>((resolve, reject) => {
    appendStream.end((err: Error | null | undefined) => {
      if (err) reject(err);
      else resolve();
    });
  });

  const durationSec = Math.floor((Date.now() - startedAt) / 1000);
  console.log();
  console.log('Benchmark complete');
  console.log(`- Processed:  ${done}`);
  console.log(`- Errors:     ${errors}`);
  console.log(`- Duration:   ${durationSec}s`);
  console.log(`- Output:     ${options.outputFile}`);
}

main().catch((error) => {
  console.error('Benchmark failed:', error.message);
  if (error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
});
