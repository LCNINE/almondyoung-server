import { createBitmap, getBit, mmToDots, setBit, type BarcodePlacement, type MonoBitmap } from './label-model';

/**
 * 가로 방향으로 그린 라벨을 ZPL 로 바꾼다(#913).
 *
 * 창고 프린터(XP-DT108B)의 인쇄폭이 108mm 라 NS(200×102mm)는 짧은 변을 폭으로 넣는다 — 그래서
 * 비트맵과 바코드 좌표를 함께 시계방향 90° 돌린다. 한글은 프린터 내장 폰트에 없어 텍스트는 전부
 * 배경 비트맵(^GF)에 들어 있고, 프린터 명령으로 그리는 것은 바코드 둘뿐이다.
 */
export interface ZplOptions {
  /** ^GF 데이터에 ZPL ACS 압축을 쓸지. 기본값은 창고 실물 출력으로 정한다(스펙 §10-3). */
  compress: boolean;
}

export function rotateClockwise(src: MonoBitmap): MonoBitmap {
  const dst = createBitmap(src.heightDots, src.widthDots);
  for (let y = 0; y < src.heightDots; y++) {
    for (let x = 0; x < src.widthDots; x++) {
      if (getBit(src, x, y)) setBit(dst, src.heightDots - 1 - y, x);
    }
  }
  return dst;
}

function hexRows(b: MonoBitmap): string[] {
  const rows: string[] = [];
  for (let y = 0; y < b.heightDots; y++) {
    const row = b.data.subarray(y * b.bytesPerRow, (y + 1) * b.bytesPerRow);
    rows.push(Buffer.from(row).toString('hex').toUpperCase());
  }
  return rows;
}

// ACS 반복 코드: G..Y = 1..19, g..y = 20..380(20 단위), z = 400. 더해서 쓴다.
function countCode(n: number): string {
  let out = '';
  let rest = n;
  while (rest >= 400) {
    out += 'z';
    rest -= 400;
  }
  if (rest >= 20) {
    out += String.fromCharCode('g'.charCodeAt(0) + Math.floor(rest / 20) - 1);
    rest %= 20;
  }
  if (rest > 0) out += String.fromCharCode('G'.charCodeAt(0) + rest - 1);
  return out;
}

function runLength(s: string): string {
  let out = '';
  let i = 0;
  while (i < s.length) {
    let j = i;
    while (j < s.length && s[j] === s[i]) j++;
    out += (j - i > 1 ? countCode(j - i) : '') + s[i];
    i = j;
  }
  return out;
}

/**
 * ZPL ACS 압축. 행 단위: 이전 행과 같으면 `:`, 끝이 0 으로 채워지면 `,`, F 로 채워지면 `!`,
 * 행 안의 반복은 반복 코드 + 문자.
 */
export function compressAcs(hexRowsIn: readonly string[]): string {
  let out = '';
  let prev: string | undefined;
  for (const row of hexRowsIn) {
    if (row === prev) {
      out += ':';
      continue;
    }
    prev = row;
    const zeroTail = /0+$/.exec(row)?.[0].length ?? 0;
    const fTail = /F+$/.exec(row)?.[0].length ?? 0;
    if (zeroTail >= 2) out += runLength(row.slice(0, row.length - zeroTail)) + ',';
    else if (fTail >= 2) out += runLength(row.slice(0, row.length - fTail)) + '!';
    else out += runLength(row);
  }
  return out;
}

function barcodeField(b: BarcodePlacement, landscapeW: number, landscapeH: number): string {
  const x = mmToDots(b.xMm);
  const y = mmToDots(b.yMm);
  const h = mmToDots(b.heightMm);
  if (x < 0 || y < 0 || x >= landscapeW || y + h > landscapeH) {
    throw new Error(`barcode ${b.kind} is outside the label: x=${x} y=${y} h=${h} on ${landscapeW}×${landscapeH}`);
  }
  // 시계방향 90°: 가로 (x, y) → 세로 (H-1-y, x). 상자 (x, y, h) 의 세로 방향 왼쪽 위는 (H-y-h, x).
  const fo = `^FO${landscapeH - y - h},${x}`;
  if (b.kind === 'ITF') {
    if (!/^(?:\d\d)+$/.test(b.data)) throw new Error(`ITF needs an even number of digits: "${b.data}"`);
    // f·g = N: 사람용 숫자는 SVG 에서 그린다. e = N: 한진 번호에 체크디지트가 이미 있다.
    return `${fo}^BY${b.moduleDots},${(b.wideRatio ?? 2.5).toFixed(1)}^B2R,${h},N,N,N^FD${b.data}^FS`;
  }
  if (!b.data || /[\^~]/.test(b.data)) {
    throw new Error(`CODE128 data is empty or contains ZPL control characters: "${b.data}"`);
  }
  return `${fo}^BY${b.moduleDots}^BCR,${h},N,N,N^FD${b.data}^FS`;
}

export function encodeZpl(landscape: MonoBitmap, barcodes: readonly BarcodePlacement[], opts: ZplOptions): string {
  const portrait = rotateClockwise(landscape);
  const total = portrait.bytesPerRow * portrait.heightDots;
  const rows = hexRows(portrait);
  const gfData = opts.compress ? compressAcs(rows) : rows.join('');
  const lines = [
    '^XA',
    `^PW${portrait.widthDots}`,
    `^LL${portrait.heightDots}`,
    '^LH0,0',
    `^FO0,0^GFA,${total},${total},${portrait.bytesPerRow},${gfData}^FS`,
    ...barcodes.map((b) => barcodeField(b, landscape.widthDots, landscape.heightDots)),
    '^PQ1',
    '^XZ',
  ];
  return lines.join('\n');
}
