#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function kstDateTag() {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10).replace(/-/g, '');
}

const minDisplayId = Number(process.env.MIN_DISPLAY_ID || '1');
if (!Number.isFinite(minDisplayId)) {
  console.error('오류: MIN_DISPLAY_ID는 숫자여야 합니다.');
  process.exit(1);
}

const dateTag = process.env.DATE_TAG || kstDateTag();
const inputPath = process.env.INPUT || path.join(process.cwd(), `sellmate-orders-${dateTag}-pending.json`);
const outputPath =
  process.env.OUTPUT || path.join(process.cwd(), `sellmate-orders-from-${minDisplayId}-${dateTag}.json`);

if (!fs.existsSync(inputPath)) {
  console.error(`오류: 입력 파일을 찾을 수 없습니다: ${inputPath}`);
  process.exit(1);
}

const source = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
const filtered = source
  .filter((order) => Number(order.displayId) >= minDisplayId)
  .sort((a, b) => Number(a.displayId) - Number(b.displayId));

fs.writeFileSync(outputPath, JSON.stringify(filtered, null, 2), 'utf-8');

const min = filtered.length ? filtered[0].displayId : null;
const max = filtered.length ? filtered[filtered.length - 1].displayId : null;
console.log(
  `[sellmate-filter] ${source.length}건 중 ${filtered.length}건 (displayId >= ${minDisplayId}) → ${outputPath} (range: ${min}~${max})`,
);
