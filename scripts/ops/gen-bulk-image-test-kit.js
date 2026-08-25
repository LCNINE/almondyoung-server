#!/usr/bin/env node
// #691 검증용 테스트 키트 생성기 (커밋 불필요 — 로컬 도구).
//
// 대량등록 이미지 매칭 목록이 1,000건 너머까지 전량 로드되는지 확인할 재료를 만든다:
//   - 엑셀 1개: 상품 250행 × (대표이미지키 1 + 부가이미지키 5) = 이미지 시트 1,500행
//   - 더미 이미지 1,450장: test-0001.jpg ~ test-1450.jpg (1×1 JPEG)
//     → 50장을 일부러 비워 전량 게이트가 열리지 않게 한다 (drafting 자동 전진 방지).
//
// 사용법: node scripts/ops/gen-bulk-image-test-kit.js [출력폴더]   (기본: ./bulk-image-test-kit)
//
// 검증 절차:
//   1. 관리자 화면에서 엑셀 업로드 → 검토 → 승인 → 이미지 업로드 패널 진입
//   2. 확인: 진행률 분모 1,500 / 목록 500건 + "…외 N건" footer / 전체 건수
//   3. images/ 폴더를 통째로 드롭 → 1,450장 전부 매칭·업로드되는지 확인
//      (수정 전이라면 1,000번 이후 450장이 매칭에서 빠졌다)
//   4. 50장이 비어 있어 게이트가 안 열린다 — 확인 끝나면 반드시 **세션 취소**로 정리.

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const PRODUCTS = 250; // × 6키 = 이미지 1,500행
const KEYS_PER_PRODUCT = 6; // 대표 1 + 부가 5 (부가 상한이 5)
const TOTAL_IMAGES = PRODUCTS * KEYS_PER_PRODUCT;
const DUMMY_COUNT = TOTAL_IMAGES - 50; // 50장 비워 게이트 차단

// 1×1 백색 JPEG. 업로드 클라이언트의 webp 변환이 디코드하므로 유효한 이미지여야 한다.
const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==',
  'base64',
);

const pad = (n) => String(n).padStart(4, '0');

async function main() {
  const outDir = path.resolve(process.argv[2] ?? './bulk-image-test-kit');
  const imgDir = path.join(outDir, 'images');
  fs.mkdirSync(imgDir, { recursive: true });

  // ── 엑셀 ──
  const wb = new ExcelJS.Workbook();

  const products = wb.addWorksheet('상품');
  products.addRow(['상품키', '상품명', '판매가', '대표이미지키', '부가이미지키']);
  const images = wb.addWorksheet('이미지');
  images.addRow(['이미지키', '원본']);

  let imageNo = 0;
  for (let p = 1; p <= PRODUCTS; p += 1) {
    const keys = [];
    for (let k = 0; k < KEYS_PER_PRODUCT; k += 1) {
      imageNo += 1;
      const imageKey = `IMG-${pad(imageNo)}`;
      keys.push(imageKey);
      images.addRow([imageKey, `test-${pad(imageNo)}.jpg`]);
    }
    products.addRow([
      `TESTIMG-${pad(p)}`,
      `이미지목록검증-${pad(p)}`,
      1000,
      keys[0],
      keys.slice(1).join('|'),
    ]);
  }

  const xlsxPath = path.join(outDir, 'bulk-image-1500-test.xlsx');
  await wb.xlsx.writeFile(xlsxPath);

  // ── 더미 이미지 ──
  for (let i = 1; i <= DUMMY_COUNT; i += 1) {
    fs.writeFileSync(path.join(imgDir, `test-${pad(i)}.jpg`), TINY_JPEG);
  }

  console.log(`생성 완료: ${outDir}`);
  console.log(`  엑셀: ${xlsxPath} (상품 ${PRODUCTS}행, 이미지 ${TOTAL_IMAGES}행)`);
  console.log(`  더미: images/ ${DUMMY_COUNT}장 (test-0001 ~ test-${pad(DUMMY_COUNT)})`);
  console.log(`  비운 것: ${DUMMY_COUNT + 1}~${TOTAL_IMAGES}번 ${TOTAL_IMAGES - DUMMY_COUNT}장 — 게이트가 안 열린다`);
  console.log('');
  console.log('확인 후 반드시 세션을 취소해 정리할 것.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
