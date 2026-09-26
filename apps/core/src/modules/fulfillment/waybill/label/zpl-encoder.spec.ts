import { createBitmap, getBit, setBit, type BarcodePlacement, type MonoBitmap } from './label-model';
import { compressAcs, encodeZpl, rotateClockwise } from './zpl-encoder';

// ZPL ACS 압축 해제기 — 테스트 전용. 압축기와 독립적으로 규격(Zebra ZPL II ^GF 압축)대로 푼다.
function decodeAcs(data: string, bytesPerRow: number): string[] {
  const rowLen = bytesPerRow * 2;
  const rows: string[] = [];
  let cur = '';
  let count = 0;
  const flush = () => {
    rows.push(cur);
    cur = '';
  };
  for (const ch of data) {
    if (ch === ':') rows.push(rows[rows.length - 1]);
    else if (ch === ',') {
      cur = cur.padEnd(rowLen, '0');
      flush();
    } else if (ch === '!') {
      cur = cur.padEnd(rowLen, 'F');
      flush();
    } else if (ch >= 'G' && ch <= 'Y')
      count += ch.charCodeAt(0) - 70; // G=1 … Y=19
    else if (ch >= 'g' && ch <= 'z')
      count += (ch.charCodeAt(0) - 102) * 20; // g=20 … z=400
    else {
      cur += ch.repeat(count || 1);
      count = 0;
      if (cur.length === rowLen) flush();
    }
  }
  return rows;
}

function hexRowsOf(b: MonoBitmap): string[] {
  const rows: string[] = [];
  for (let y = 0; y < b.heightDots; y++) {
    const row = b.data.subarray(y * b.bytesPerRow, (y + 1) * b.bytesPerRow);
    rows.push(Buffer.from(row).toString('hex').toUpperCase());
  }
  return rows;
}

// NS 라벨 크기(가로 방향) 비트맵.
const nsBitmap = () => createBitmap(1600, 816);

const ITF: BarcodePlacement = {
  kind: 'ITF',
  data: '452716978431',
  xMm: 149.1,
  yMm: 43.8,
  heightMm: 20,
  moduleDots: 3,
  wideRatio: 2.5,
};

describe('rotateClockwise', () => {
  it('가로 방향 (x, y) 를 세로 방향 (H-1-y, x) 로 옮긴다', () => {
    const src = createBitmap(3, 2); // 가로 3, 세로 2
    setBit(src, 0, 0);
    setBit(src, 2, 1);
    const dst = rotateClockwise(src);
    expect([dst.widthDots, dst.heightDots]).toEqual([2, 3]);
    expect(getBit(dst, 1, 0)).toBe(true); // (0,0) → (2-1-0, 0)
    expect(getBit(dst, 0, 2)).toBe(true); // (2,1) → (2-1-1, 2)
    expect(getBit(dst, 0, 0)).toBe(false);
  });
});

describe('compressAcs', () => {
  it('압축을 풀면 원본 행과 같다', () => {
    const b = createBitmap(64, 6);
    for (let x = 0; x < 64; x++) setBit(b, x, 1); // 전부 검정
    for (let x = 0; x < 8; x++) setBit(b, x, 3); // 앞만 검정
    for (let x = 0; x < 8; x++) setBit(b, x, 4); // 3행 반복
    setBit(b, 63, 5); // 끝만 검정
    const rows = hexRowsOf(b);
    expect(decodeAcs(compressAcs(rows), b.bytesPerRow)).toEqual(rows);
  });

  it('흰 여백이 대부분인 라벨은 원본 hex 보다 훨씬 짧다', () => {
    const b = nsBitmap();
    for (let x = 100; x < 400; x++) setBit(b, x, 400);
    const rows = hexRowsOf(b);
    const packed = compressAcs(rows);
    expect(packed.length).toBeLessThan(rows.join('').length / 100);
    expect(decodeAcs(packed, b.bytesPerRow)).toEqual(rows);
  });

  it('반복 길이 400 이상도 z 를 이어 붙여 표현한다', () => {
    // 900 = 400 + 400 + 100, 100 = k(20×5)
    expect(compressAcs(['A'.repeat(900) + 'B'])).toBe('zzkAB');
  });
});

describe('encodeZpl', () => {
  it('90° 회전해 폭 816 · 길이 1600 으로 선언하고 ^XA 로 열어 ^XZ 로 닫는다', () => {
    const zpl = encodeZpl(nsBitmap(), [], { compress: false });
    expect(zpl.startsWith('^XA')).toBe(true);
    expect(zpl.trimEnd().endsWith('^XZ')).toBe(true);
    expect(zpl).toContain('^PW816');
    expect(zpl).toContain('^LL1600');
  });

  it('비압축 ^GF 의 바이트 수는 bytesPerRow × 행 수이고 데이터는 그 두 배 hex 다', () => {
    const zpl = encodeZpl(nsBitmap(), [], { compress: false });
    const m = /\^GFA,(\d+),(\d+),(\d+),([0-9A-F]+)\^FS/.exec(zpl);
    if (!m) throw new Error('^GFA field not found in ZPL');
    const [, total, total2, bpr, data] = m;
    expect(Number(bpr)).toBe(102); // 816 / 8
    expect(Number(total)).toBe(102 * 1600);
    expect(total2).toBe(total);
    expect(data.length).toBe(2 * 102 * 1600);
  });

  it('압축 ^GF 를 풀면 회전한 비트맵과 같다', () => {
    const b = nsBitmap();
    for (let x = 10; x < 200; x++) setBit(b, x, 20);
    const zpl = encodeZpl(b, [], { compress: true });
    const m = /\^GFA,(\d+),(\d+),(\d+),([^^]+)\^FS/.exec(zpl);
    if (!m) throw new Error('^GFA field not found in ZPL');
    expect(decodeAcs(m[4], Number(m[3]))).toEqual(hexRowsOf(rotateClockwise(b)));
  });

  it('ITF 는 회전 좌표 ^FO(H-y-h, x) 에 ^BY3,2.5 ^B2R 로, 사람용 숫자·체크디지트 없이 놓는다', () => {
    const zpl = encodeZpl(nsBitmap(), [ITF], { compress: false });
    // x = round(149.1×8) = 1193, y = round(43.8×8) = 350, h = 160 → FO(816-350-160, 1193) = (306, 1193)
    expect(zpl).toContain('^FO306,1193^BY3,2.5^B2R,160,N,N,N^FD452716978431^FS');
  });

  it('CODE128 은 ^BCR 로 놓는다', () => {
    const code: BarcodePlacement = { kind: 'CODE128', data: '150', xMm: 4.4, yMm: 18.3, heightMm: 8, moduleDots: 2 };
    const zpl = encodeZpl(nsBitmap(), [code], { compress: false });
    // x = 35, y = 146, h = 64 → FO(816-146-64, 35) = (606, 35)
    expect(zpl).toContain('^FO606,35^BY2^BCR,64,N,N,N^FD150^FS');
  });

  it('ITF 데이터가 짝수 자리 숫자가 아니면 던진다', () => {
    expect(() => encodeZpl(nsBitmap(), [{ ...ITF, data: '12345' }], { compress: false })).toThrow(/ITF/);
    expect(() => encodeZpl(nsBitmap(), [{ ...ITF, data: 'WBL-1234' }], { compress: false })).toThrow(/ITF/);
  });

  it('CODE128 데이터가 비었거나 ZPL 제어문자(^ ~)를 담으면 던진다', () => {
    const base: BarcodePlacement = { kind: 'CODE128', data: '', xMm: 4, yMm: 18, heightMm: 8, moduleDots: 2 };
    expect(() => encodeZpl(nsBitmap(), [base], { compress: false })).toThrow(/CODE128/);
    expect(() => encodeZpl(nsBitmap(), [{ ...base, data: '1^XZ' }], { compress: false })).toThrow(/CODE128/);
  });

  it('라벨 밖에 놓인 바코드는 던진다', () => {
    expect(() => encodeZpl(nsBitmap(), [{ ...ITF, yMm: 95 }], { compress: false })).toThrow(/outside/);
  });
});
