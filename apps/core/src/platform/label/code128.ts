/**
 * Code128 최적 부호화(#1281). 숫자 쌍을 Code C 로 접어 막대를 줄이고, ZPL `^BC` 모드 N 의
 * invocation code 로 전환을 지시한다(`>;` Start C, `>:` Start B, `>5` → C, `>6` → B, `><` 리터럴 '>').
 */
export interface Code128Plan {
  zplData: string;
  /** 시작 + 데이터 + 전환 + 체크 기호 × 11 + 종료 13 모듈. */
  modules: number;
}

const isDigit = (c: string): boolean => c >= '0' && c <= '9';

function digitRunAt(data: string, from: number): number {
  let n = 0;
  while (from + n < data.length && isDigit(data[from + n])) n++;
  return n;
}

/** ASCII 32~126 밖, `^`·`~`, 빈 문자열이면 null. 템플릿이 먼저 걸러야 한다. */
export function planCode128(data: string): Code128Plan | null {
  if (data.length === 0) return null;
  for (const ch of data) {
    const code = ch.charCodeAt(0);
    if (code < 32 || code > 126 || ch === '^' || ch === '~') return null;
  }

  let out = '';
  let symbols = 0;
  let mode: 'B' | 'C';
  const leadingRun = digitRunAt(data, 0);
  if (leadingRun >= 4 || (data.length === 2 && leadingRun === 2)) {
    mode = 'C';
    out += '>;';
  } else {
    mode = 'B';
    out += '>:';
  }
  symbols += 1;

  let i = 0;
  while (i < data.length) {
    if (mode === 'C') {
      if (i + 1 < data.length && isDigit(data[i]) && isDigit(data[i + 1])) {
        out += data.slice(i, i + 2);
        symbols += 1;
        i += 2;
      } else {
        out += '>6';
        symbols += 1;
        mode = 'B';
      }
      continue;
    }
    const run = digitRunAt(data, i);
    if ((i + run === data.length && run >= 4) || run >= 6) {
      if (run % 2 === 1) {
        out += data[i];
        symbols += 1;
        i += 1;
      }
      out += '>5';
      symbols += 1;
      mode = 'C';
      continue;
    }
    out += data[i] === '>' ? '><' : data[i];
    symbols += 1;
    i += 1;
  }

  symbols += 1; // 체크 기호
  return { zplData: out, modules: 11 * symbols + 13 };
}
