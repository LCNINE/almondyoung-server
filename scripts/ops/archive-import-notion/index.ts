/**
 * 노션 export 를 아카이브로 옮기기 위한 드라이런.
 *
 * 쓰지 않는다 — 무엇이 몇 건 생길지만 센다. 525개가 잘못 들어가면 되돌리는 값이
 * 크기 때문에, 숫자가 export 실물과 맞는 걸 먼저 확인하고 나서 쓰기 경로를 붙인다.
 *
 *   npx tsx scripts/ops/archive-import-notion/index.ts <풀어 둔 export 루트>
 */
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { collectPages, convertPage, type NotionPage } from './parse';

const MAX_ANCESTOR_DEPTH = 64;

function main() {
  const root = process.argv[2];
  if (!root) {
    console.error('사용법: npx tsx scripts/ops/archive-import-notion/index.ts <export 루트>');
    process.exit(1);
  }

  const exportRoot = path.resolve(root);
  const pages = collectPages(exportRoot);
  const byRelPath = new Map<string, NotionPage>(pages.map((page) => [page.relPath, page]));

  const converted = pages.map((page) => convertPage(page, byRelPath, exportRoot));

  const subPages = converted.reduce((n, p) => n + p.subPageLinks.length, 0);
  const inlineLinks = converted.reduce((n, p) => n + p.inlineLinks.length, 0);
  const callouts = converted.reduce((n, p) => n + p.calloutCount, 0);
  const assetRefs = converted.flatMap((p) => p.assetRefs);
  // 같은 파일을 여러 문단이 참조한다. 업로드는 파일 단위로 한 번만 한다.
  const uniqueAssets = new Set(assetRefs);
  const maxDepth = Math.max(...pages.map((page) => page.depth));

  const orphans = pages.filter((page) => page.parentRelPath !== null && !byRelPath.has(page.parentRelPath));
  const unresolved = converted.flatMap((p) => p.unresolved.map((link) => ({ from: p.page.relPath, ...link })));
  const databaseLinks = converted.reduce((n, p) => n + p.databaseLinks.length, 0);

  const missingAssets = converted.flatMap((p) => p.missingAssets.map((asset) => ({ from: p.page.relPath, asset })));

  // 디스크에는 있는데 어느 본문도 안 가리키는 파일. 대부분 DB(표) export 다.
  const onDisk: string[] = [];
  const walkFiles = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const abs = path.join(dir, entry);
      if (statSync(abs).isDirectory()) walkFiles(abs);
      else if (!entry.endsWith('.md')) onDisk.push(path.relative(exportRoot, abs).split(path.sep).join('/'));
    }
  };
  walkFiles(exportRoot);
  const unreferenced = onDisk.filter((file) => !uniqueAssets.has(file));

  const byExtension = new Map<string, number>();
  for (const asset of uniqueAssets) {
    const ext = path.extname(asset).toLowerCase() || '(확장자 없음)';
    byExtension.set(ext, (byExtension.get(ext) ?? 0) + 1);
  }

  console.log('== 드라이런 (쓰기 없음) ==');
  console.log(`페이지            ${pages.length}`);
  console.log(`최대 깊이         ${maxDepth} (상한 ${MAX_ANCESTOR_DEPTH})`);
  console.log(`하위 페이지 블록  ${subPages}`);
  console.log(`인라인 페이지 링크 ${inlineLinks}`);
  console.log(`콜아웃(<aside>)   ${callouts}`);
  console.log(`표(DB) 페이지 링크 ${databaseLinks}`);
  console.log(`첨부 참조         ${assetRefs.length} (파일 ${uniqueAssets.size})`);

  console.log('\n-- 첨부 확장자별 (파일 기준) --');
  for (const [ext, count] of [...byExtension].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${ext.padEnd(8)} ${count}`);
  }

  console.log(`\n-- 참조했는데 디스크에 없는 첨부 ${missingAssets.length}건 --`);
  for (const item of missingAssets.slice(0, 10)) {
    console.log(`  ${item.from}\n    → ${item.asset}`);
  }

  console.log(`\n-- 디스크에 있는데 본문이 안 가리키는 파일 ${unreferenced.length}건 --`);
  for (const file of unreferenced.slice(0, 20)) {
    console.log(`  ${file}`);
  }

  console.log(`\n-- 부모를 못 찾은 페이지 ${orphans.length}건 --`);
  for (const page of orphans.slice(0, 20)) {
    console.log(`  ${page.relPath}`);
  }

  console.log(`\n-- 미해결 링크 ${unresolved.length}건 --`);
  for (const link of unresolved.slice(0, 40)) {
    console.log(`  ${link.from}\n    → ${link.resolved}`);
  }
  if (unresolved.length > 40) {
    console.log(`  … 그리고 ${unresolved.length - 40}건 더`);
  }

  if (unresolved.length > 0 || orphans.length > 0 || missingAssets.length > 0) {
    console.log('\n미해결이 남아 있다. 경로 정규화를 고치기 전에는 쓰기로 넘어가지 않는다.');
    process.exitCode = 1;
  }
}

main();
