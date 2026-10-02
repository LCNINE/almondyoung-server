# 스테이션 UI — PR B (셸 + warehouse-app 게이트) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Windows 스테이션 프로필에 «현장 작업 프로그램» 셸(탭 바·기능키·명령 바코드·소리·상태바)을 씌우고, 기존 화면은 탭 안에 그대로 그린다. warehouse-app 자체 `tsc -b`·`vitest` 를 PR 게이트로 건다.

**Architecture:** 셸 부품은 전부 `native/warehouse-app/src/station/` 에 둔다. 판정은 순수 함수(키 해석·명령 코드·액션 해석·탭 판정·상태바 규칙·Code128)로 두고 표 테스트하며, React 층(레지스트리 Provider·피드백 Provider·셸 프레임)은 그 함수를 조립만 한다. 셸 선택은 `AuthedLayout` 한 곳(`isStationDevice()`), 핸드헬드 경로는 손대지 않는다. 명령 바코드는 스캔 버스(`ScanProvider`) 앞단에서 떼어 셸로 보낸다.

**Tech Stack:** React 19, TanStack Router 1.x, Tailwind 4, Vitest 4 + Testing Library(jsdom), Tauri 2(WebView2), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-02-warehouse-station-ui-design.md` (§4 프로필과 화면 구조, §5 스테이션 셸, §10.2 게이트, §11 PR 분할)

## 이 계획이 정한 것 (스펙이 «계획이 정함» 으로 남긴 것 + 코드에서 도출한 것)

| 항목 | 결정 | 근거 |
| --- | --- | --- |
| 명령 바코드 형식 | `%90%00` = Esc, `%90%01`…`%90%12` = F1…F12, `%91%0`…`%91%9` = 숫자. **`%` 로 시작하는 스캔은 전부 명령**(모르면 오류음) | 숫자·기호만(§5.3). 상품(숫자)·송장(숫자)·위치(`B-05-03`) 바코드는 `%` 로 시작하지 않는다. 목업 시트의 `%90%08` 과 같은 꼴 |
| 액션의 `command` | 선언에 따로 두지 않고 **키에서 파생**(`commandCodeOfKey`). 명령 = 그 키를 누른 것 | 같은 키가 화면 상태마다 다른 액션이어도(§5.2) 시트 한 장이 그대로 맞는다 |
| F2 배치 현황 | 새 경로 `/outbound/batches` 가 PR C 전까지 **지금 출고 화면을 그대로** 그린다(배치 카드가 거기 있다) | §4 «아직 새로 안 만들어진 탭은 지금 화면을 그대로» |
| 하위 탭 | **F4 만**(적치·되돌림 적치·이동). F3 은 입고 화면이 간편입고·입고내역 링크를 이미 가져 두지 않는다 | U3(스테이션은 전 작업) + U2(같은 정보 두 곳 금지) |
| 작업자 표시 | **이번엔 그리지 않는다** — 앱에 이름 출처가 없다(`work-context` 는 `actorId` UUID 뿐). 창고 이름이 설정 링크다 | U2. 필요해지면 core 가 이름을 내려 주는 별도 작업 |
| §5.6 셋째 줄(대기 중 숫자 타이핑 → 직접 입력칸) | **PR C 로 넘긴다** | «대기 상태» 를 가진 첫 화면이 F1. B 엔 소비자가 없어 인터페이스를 추측하게 된다 |
| Esc | 화면이 Esc 액션을 선언했을 때만 셸이 가져간다. 확인창(`[aria-modal="true"]`)이 열려 있으면 늘 확인창 몫 | 기존 Esc 처리 2곳(`ConfirmDialog`·`SessionCountScreen`)을 깨지 않는다 |
| 웹뷰 단축키 | F1~F12 는 처리 여부와 무관하게 `preventDefault`. Tauri 설정엔 WebView2 `AreBrowserAcceleratorKeysEnabled` 노출이 없다(wry 0.55 는 갖고 있으나 tauri 2.11 설정 스키마에 없음) | 실기에서 F5 가 그래도 새로고침되면 → «게이트와 PR» 의 대비책 |

## Global Constraints

- 작업 디렉터리: 앱 명령은 전부 `native/warehouse-app` 에서 돈다. 이 계획의 `Run:` 은 그 디렉터리 기준이다
- 워크트리에서 실행할 때: 이름에 `+` 금지. 앱 `node_modules` 가 없으므로 `ln -s <메인 체크아웃>/native/warehouse-app/node_modules native/warehouse-app/node_modules` (루트 `node_modules` 도 같은 방식). 서브에이전트는 **워크트리 경로 안에서만** 편집하고, 끝나면 `git -C <메인 체크아웃> status --short` 가 비어 있는지 본다
- 핸드헬드(Android) 동작은 바뀌지 않는다(스펙 §2-5). 새 훅(`useStationActions`·`useFeedback`·`useDigitCommands`)은 셸 밖에서 **아무 일도 하지 않아야** 한다
- 화면 문구는 U2: 작업자가 그 순간 행동하는 데 필요한 것만. 설명·캡션·범례를 새로 깔지 않는다. 작업자 문구는 「라벨」 대신 「송장」
- 셸 치수(§5.1): 탭 바 52px(`h-[52px]`) · 기능키 바 56px(`h-14`) · 상태바 28px(`h-7`). 창 기본 1280×800, 시작 시 최대화
- 셸 색은 목업 값 그대로: 탭 바 `#161A22`, 작업 영역 `#EDEEF0`, 본문 글자 `#15171C`, 테두리 `#D5D8DE`, 상태바 `#E2E4E8`, 초록 `#1E7A46`, 빨강 `#C62828`, 노랑 `#D99A00`/`#FFF1C7`
- 새 의존성 0(Code128 도 직접 구현, §5.3)
- 타입: `any` 금지. 프로덕션 코드에서 `as` 캐스팅 금지(`as const` 는 허용). 테스트의 가짜 객체는 이 저장소 관례대로 `as unknown as`/`as never` 허용
- 게이트(앱): `npx tsc -b` 에러 0 · `npx vitest run` 실패 0 · `npx oxlint` 새 경고 0
- 게이트(루트): `httpClient.ts` 는 루트 core 통합 스펙이 import 한다 → Task 7 이후 루트 `npm run type-check` 에러 0
- 커밋 메시지는 한국어, `feat(warehouse-app): …` / `ci: …` 꼴

## Review Focus

1. **핸드헬드는 그대로다** — Android 프로필에선 탭 바가 없고, F5 를 눌러도 앱이 가로채지 않으며(`preventDefault` 없음), 홈 타일·「Almond WMS」 제목 줄이 그대로다 → Task 9 의 핸드헬드 테스트
2. **예전 스테이션 홈 타일의 작업이 하나도 사라지지 않는다(U3)** — 재고조회·출고작업·입고·입고내역·적치·되돌림 적치·이동·실사·설정에 탭·하위 탭·화면 안 링크로 닿는다 → Task 9 의 도달성 테스트
3. **확인창이 열린 상태의 Esc·기능키** — Esc 는 확인창의 취소로 가고, 기능키는 웹뷰 기본 동작만 막고 뒤의 화면 액션을 돌리지 않는다 → Task 4
4. **명령 바코드가 송장·상품 스캔으로 새지 않는다** — 출고 화면은 받은 스캔을 전부 송장 조회로 연다. `%90%03` 이 일반 구독자에게 가면 «없는 송장» 이 된다 → Task 5(버스) + Task 8(셸)
5. **Alt+F4·Ctrl/Shift 조합·키 누르고 있기** — Alt+F4 로 창이 닫혀야 하고(가로채지 않는다), 누르고 있는 F 키의 자동 반복은 액션을 한 번만 돌린다 → Task 4

---

### Task 1: warehouse-app CI 게이트 (§10.2)

**Files:**
- Create: `.github/workflows/warehouse-app-gates.yml`
- Modify: `CLAUDE.md` (검증 게이트 절의 «프론트·통합·외부환경 테스트» 코드 블록)

**Interfaces:**
- Produces: PR 체크 `Warehouse app gates / gates` — `native/warehouse-app/**` 를 바꾸는 PR 에서 `tsc -b`·`vitest run` 을 돌린다

- [ ] **Step 1: 지금 develop 에서 두 명령이 초록인지 확인(기준선)**

Run: `npx tsc -b; echo "tsc exit $?"; npx vitest run 2>&1 | tail -5`
Expected: `tsc exit 0`, `Test Files  111 passed`(10-02 실측 111 files / 930 tests — 숫자가 달라도 실패 0 이면 된다)

- [ ] **Step 2: 워크플로 작성**

`.github/workflows/warehouse-app-gates.yml`:

```yaml
name: Warehouse app gates

# warehouse-app 자체 타입 검사(tsc -b)와 vitest 를 PR 게이트로 고정한다 (스테이션 UI 스펙 §10.2).
#
# verification-gates.yml 은 이 앱의 의존성을 «설치만» 한다 — 루트 core 통합 스펙이 앱의 httpClient·
# operationRunner 를 import 하므로 루트 타입 검사의 모듈 해석에 필요해서다. 루트 tsconfig 는 native 를
# exclude 하므로 앱의 화면·훅 타입과 테스트는 이 워크플로가 없으면 어느 PR 에서도 돌지 않는다
# (warehouse-demo-windows.yml 은 데모 설정·스캔 경계 테스트 일부만 돈다).

on:
  pull_request:
    types: [opened, synchronize, reopened]
    paths:
      - 'native/warehouse-app/**'
      - '.github/workflows/warehouse-app-gates.yml'
  push:
    branches: [develop]
    paths:
      - 'native/warehouse-app/**'
      - '.github/workflows/warehouse-app-gates.yml'

concurrency:
  group: warehouse-app-gates-${{ github.ref }}
  cancel-in-progress: true

jobs:
  gates:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    defaults:
      run:
        working-directory: native/warehouse-app
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: npm
          cache-dependency-path: native/warehouse-app/package-lock.json

      - name: Install
        run: npm ci

      # spec 파일 포함 전 범위(tsconfig.app.json 의 include 가 src 전체). 기준선은 에러 0 이다.
      - name: Type check
        run: npx tsc -b

      - name: Unit tests
        run: npx vitest run
```

- [ ] **Step 3: YAML 파싱 확인**

Run: `python3 -c "import yaml; d=yaml.safe_load(open('../../.github/workflows/warehouse-app-gates.yml')); print(sorted(d[True].keys()) if True in d else sorted(d['on'].keys()))"`
Expected: `['pull_request', 'push']` (PyYAML 은 `on` 을 불리언 `True` 로 읽는다 — 어느 쪽이든 두 키가 나오면 된다)

- [ ] **Step 4: CLAUDE.md 에 게이트 한 줄**

`CLAUDE.md` 의 «프론트·통합·외부환경 테스트는 별도 명령이다» 코드 블록에서 `npm run test:admin-web` 줄 바로 아래에 추가:

```bash
(cd native/warehouse-app && npx tsc -b && npx vitest run)  # warehouse-app — native/warehouse-app/** 변경 PR 에 warehouse-app-gates.yml 이 돈다
```

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/warehouse-app-gates.yml CLAUDE.md
git commit -m "ci: warehouse-app 자체 tsc -b·vitest 를 PR 게이트로 건다"
```

---

### Task 2: Code128 인코더 (§5.3, 의존성 0)

**Files:**
- Create: `native/warehouse-app/src/station/code128.ts`
- Test: `native/warehouse-app/src/station/code128.test.ts`

**Interfaces:**
- Produces: `encodeCode128B(text: string): string` — 모듈 비트열(`'1'` 막대, `'0'` 여백), 시작 B·체크 문자·정지 포함, 조용한 여백 제외. 길이 = `11 × (글자 수 + 2) + 13`
- Produces: `code128BChecksum(text: string): number`

- [ ] **Step 1: 실패하는 테스트**

`src/station/code128.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { code128BChecksum, encodeCode128B } from './code128';

// 기대 비트열은 독립 구현(jsbarcode 3.x, CODE128B)으로 뽑았다 — 표를 옮겨 적다 틀린 것을 잡는다.
describe('encodeCode128B', () => {
  it.each([
    ['%90%07', '11010010000100010011001110010110010011101100100010011001001110110011101101110101000110001100011101011'],
    ['%90%00', '11010010000100010011001110010110010011101100100010011001001110110010011101100100010111101100011101011'],
    ['%90%12', '11010010000100010011001110010110010011101100100010011001001110011011001110010100011001001100011101011'],
    ['%91%3', '110100100001000100110011100101100100111001101000100110011001011100100111011001100011101011'],
  ])('%s', (text, bits) => {
    expect(encodeCode128B(text)).toBe(bits);
  });

  it('길이 = 11 × (글자 수 + 2) + 13 — 시작·체크 11모듈씩, 정지 13모듈', () => {
    expect(encodeCode128B('%90%07')).toHaveLength(11 * 8 + 13);
    expect(encodeCode128B('%91%3')).toHaveLength(11 * 7 + 13);
  });

  it('시작 B 로 시작하고 정지 문자로 끝난다', () => {
    const bits = encodeCode128B('%90%07');
    expect(bits.startsWith('11010010000')).toBe(true);
    expect(bits.endsWith('1100011101011')).toBe(true);
  });

  it.each(['', '가', 'a\n', 'é'])('부호 집합 B 로 못 쓰는 입력 %j 은 거절한다', (text) => {
    expect(() => encodeCode128B(text)).toThrow(RangeError);
  });
});

describe('code128BChecksum', () => {
  it('(104 + Σ 위치 × 값) mod 103', () => {
    // % = 5, 9 = 25, 1 = 17, % = 5, 3 = 19 → 104 + 5 + 50 + 51 + 20 + 95 = 325 → 325 mod 103 = 16
    expect(code128BChecksum('%91%3')).toBe(16);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/station/code128.test.ts`
Expected: FAIL — `Failed to resolve import "./code128"`

- [ ] **Step 3: 구현**

`src/station/code128.ts`:

```ts
/**
 * Code128 부호 집합 B 인코더 — 명령 바코드 시트용(스테이션 UI 스펙 §5.3, 의존성 0).
 * 결과는 모듈 비트열이다: '1' 은 막대, '0' 은 여백. 시작(B)·체크 문자·정지를 포함하고, 조용한 여백은 그리는 쪽 몫이다.
 * 부호 집합 B 는 ASCII 32~126 을 값 0~94 로 쓴다.
 */
const PATTERNS: readonly string[] = [
  '11011001100', '11001101100', '11001100110', '10010011000', '10010001100', '10001001100',
  '10011001000', '10011000100', '10001100100', '11001001000', '11001000100', '11000100100',
  '10110011100', '10011011100', '10011001110', '10111001100', '10011101100', '10011100110',
  '11001110010', '11001011100', '11001001110', '11011100100', '11001110100', '11101101110',
  '11101001100', '11100101100', '11100100110', '11101100100', '11100110100', '11100110010',
  '11011011000', '11011000110', '11000110110', '10100011000', '10001011000', '10001000110',
  '10110001000', '10001101000', '10001100010', '11010001000', '11000101000', '11000100010',
  '10110111000', '10110001110', '10001101110', '10111011000', '10111000110', '10001110110',
  '11101110110', '11010001110', '11000101110', '11011101000', '11011100010', '11011101110',
  '11101011000', '11101000110', '11100010110', '11101101000', '11101100010', '11100011010',
  '11101111010', '11001000010', '11110001010', '10100110000', '10100001100', '10010110000',
  '10010000110', '10000101100', '10000100110', '10110010000', '10110000100', '10011010000',
  '10011000010', '10000110100', '10000110010', '11000010010', '11001010000', '11110111010',
  '11000010100', '10001111010', '10100111100', '10010111100', '10010011110', '10111100100',
  '10011110100', '10011110010', '11110100100', '11110010100', '11110010010', '11011011110',
  '11011110110', '11110110110', '10101111000', '10100011110', '10001011110', '10111101000',
  '10111100010', '11110101000', '11110100010', '10111011110', '10111101110', '11101011110',
  '11110101110', '11010000100', '11010010000', '11010011100', '1100011101011',
];
const START_B = 104;
const STOP = 106;

function valueOf(ch: string): number {
  const code = ch.charCodeAt(0);
  if (ch.length !== 1 || code < 32 || code > 126)
    throw new RangeError(`Code128B 로 쓸 수 없는 문자: ${JSON.stringify(ch)}`);
  return code - 32;
}

function valuesOf(text: string): number[] {
  if (text.length === 0) throw new RangeError('빈 문자열은 바코드로 만들 수 없다');
  return [...text].map(valueOf);
}

export function code128BChecksum(text: string): number {
  return valuesOf(text).reduce((sum, value, i) => sum + (i + 1) * value, START_B) % 103;
}

export function encodeCode128B(text: string): string {
  const values = valuesOf(text);
  return [START_B, ...values, code128BChecksum(text), STOP].map((v) => PATTERNS[v]).join('');
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/station/code128.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/station/code128.ts src/station/code128.test.ts
git commit -m "feat(warehouse-app): 명령 바코드 시트용 Code128B 인코더"
```

---

### Task 3: 셸 키와 명령 바코드 코덱

**Files:**
- Create: `native/warehouse-app/src/station/keys.ts`
- Create: `native/warehouse-app/src/core/hardware/scan/commandPrefix.ts`
- Create: `native/warehouse-app/src/station/commandCode.ts`
- Test: `native/warehouse-app/src/station/keys.test.ts`
- Test: `native/warehouse-app/src/station/commandCode.test.ts`

**Interfaces:**
- Produces (`keys.ts`): `FUNCTION_KEYS`, `type FunctionKey = 'F1'|…|'F12'`, `TAB_KEYS = ['F1'…'F6']`, `type TabKey`, `type StationKey = FunctionKey | 'Escape'`, `STATION_KEYS: readonly StationKey[]`(F1…F12, Escape 순), `stationKeyOf(ev: KeyLike): StationKey | null`
- Produces (`commandPrefix.ts`, core 층 — 스캔 버스가 쓴다): `COMMAND_PREFIX = '%'`, `isCommandCode(code: string): boolean`
- Produces (`commandCode.ts`): `type Command = { kind: 'key'; key: StationKey } | { kind: 'digit'; digit: number } | { kind: 'unknown'; code: string }`, `commandCodeOfKey(key: StationKey): string`, `commandCodeOfDigit(digit: number): string`, `parseCommand(code: string): Command`

- [ ] **Step 1: 실패하는 테스트**

`src/station/keys.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { STATION_KEYS, TAB_KEYS, stationKeyOf } from './keys';

const press = (key: string, mods: Partial<Record<'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey', boolean>> = {}) => ({
  key,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...mods,
});

describe('stationKeyOf', () => {
  it.each([...STATION_KEYS])('%s 는 셸 키', (key) => {
    expect(stationKeyOf(press(key))).toBe(key);
  });

  it.each(['F13', 'a', '5', '%', 'Enter', 'Tab', 'Esc'])('%s 는 셸 키가 아니다', (key) => {
    expect(stationKeyOf(press(key))).toBeNull();
  });

  it.each(['altKey', 'ctrlKey', 'metaKey', 'shiftKey'] as const)(
    '%s 가 붙은 조합은 건드리지 않는다(Alt+F4 창 닫기, Shift+F10 등)',
    (mod) => {
      expect(stationKeyOf(press('F4', { [mod]: true }))).toBeNull();
    }
  );

  it('키 순서는 F1…F12 다음 Esc, 탭 키는 F1~F6', () => {
    expect(STATION_KEYS).toEqual(['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12', 'Escape']);
    expect(TAB_KEYS).toEqual(['F1', 'F2', 'F3', 'F4', 'F5', 'F6']);
  });
});
```

`src/station/commandCode.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isCommandCode } from '../core/hardware/scan/commandPrefix';
import { commandCodeOfDigit, commandCodeOfKey, parseCommand } from './commandCode';
import { STATION_KEYS } from './keys';

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

describe('명령 바코드', () => {
  it.each([...STATION_KEYS])('%s 키 명령은 왕복한다', (key) => {
    expect(parseCommand(commandCodeOfKey(key))).toEqual({ kind: 'key', key });
  });

  it('Esc 는 %90%00, F7 은 %90%07, F12 는 %90%12', () => {
    expect(commandCodeOfKey('Escape')).toBe('%90%00');
    expect(commandCodeOfKey('F7')).toBe('%90%07');
    expect(commandCodeOfKey('F12')).toBe('%90%12');
  });

  it.each(DIGITS)('숫자 %i 명령은 왕복한다', (digit) => {
    expect(parseCommand(commandCodeOfDigit(digit))).toEqual({ kind: 'digit', digit });
  });

  it('모든 명령 코드는 숫자와 기호만, 3자 이상, 서로 다르다 — 한글 IME 가 켜져도 그대로 읽힌다', () => {
    const codes = [...STATION_KEYS.map(commandCodeOfKey), ...DIGITS.map(commandCodeOfDigit)];
    for (const code of codes) {
      expect(code).toMatch(/^[0-9%]+$/);
      expect(code.length).toBeGreaterThanOrEqual(3); // 스캔 버퍼 minLength
      expect(isCommandCode(code)).toBe(true);
    }
    expect(new Set(codes).size).toBe(codes.length);
  });

  it.each(['%90%13', '%90%7', '%90%007', '%92%1', '%91%10', '%', '%90%07 '])('%s 는 모르는 명령', (code) => {
    expect(parseCommand(code)).toEqual({ kind: 'unknown', code });
  });

  it.each(['8801234567890', '421033881907', '4210-3388-1907', 'B-05-03', 'C-07-1'])(
    '%s 는 명령이 아니다(상품·송장·위치)',
    (code) => {
      expect(isCommandCode(code)).toBe(false);
    }
  );

  it.each([10, -1, 1.5])('숫자 명령은 0~9 정수만 만든다 (%s 거절)', (digit) => {
    expect(() => commandCodeOfDigit(digit)).toThrow(RangeError);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/station/keys.test.ts src/station/commandCode.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`src/station/keys.ts`:

```ts
export const FUNCTION_KEYS = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'] as const;
export type FunctionKey = (typeof FUNCTION_KEYS)[number];

/** 탭 전환 키(스펙 §4). 셸 자신의 액션이다. */
export const TAB_KEYS = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6'] as const;
export type TabKey = (typeof TAB_KEYS)[number];

export type StationKey = FunctionKey | 'Escape';

/** 기능키 바·명령 시트가 그리는 순서. Esc 는 맨 끝(바에서는 오른쪽 끝). */
export const STATION_KEYS: readonly StationKey[] = [...FUNCTION_KEYS, 'Escape'];

export interface KeyLike {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

/**
 * 셸이 처리할 키인가. 수식키가 붙은 조합은 OS·웹뷰 몫이라 건드리지 않는다 — Alt+F4 로 창이 닫혀야 하고,
 * Shift+F10(문맥 메뉴)·Ctrl+F5 를 셸 액션으로 오인하면 안 된다.
 */
export function stationKeyOf(ev: KeyLike): StationKey | null {
  if (ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey) return null;
  return STATION_KEYS.find((key) => key === ev.key) ?? null;
}
```

`src/core/hardware/scan/commandPrefix.ts`:

```ts
/**
 * 명령 바코드의 접두어(스테이션 UI 스펙 §5.3). `%` 로 시작하는 스캔은 전부 명령이다 — 상품(숫자)·송장(숫자)·
 * 위치(`B-05-03` 꼴) 바코드는 `%` 로 시작하지 않는다. 스캔 버스가 이것으로 명령을 일반 구독자에게서 떼어 낸다.
 * 형식의 나머지(어떤 명령인지)는 `src/station/commandCode.ts` 가 안다.
 */
export const COMMAND_PREFIX = '%';

export function isCommandCode(code: string): boolean {
  return code.startsWith(COMMAND_PREFIX);
}
```

`src/station/commandCode.ts`:

```ts
import { STATION_KEYS, type StationKey } from './keys';

/**
 * 명령 바코드(스펙 §5.3). 숫자·기호만 쓴다 — 스캔 버퍼는 한글 IME 조합 입력(isComposing)을 버리므로
 * 영문 명령은 IME 켠 PC 에서 사라지거나 한글로 바뀐다.
 *
 *   %90%00            Esc
 *   %90%01 … %90%12   F1 … F12   — 명령 = 그 키를 누른 것. 같은 키가 화면 상태마다 다른 액션이어도 시트 한 장이 맞는다
 *   %91%0 … %91%9     숫자 0 … 9 — 「수량」 입력 대신
 */
export type Command =
  | { kind: 'key'; key: StationKey }
  | { kind: 'digit'; digit: number }
  | { kind: 'unknown'; code: string };

export function commandCodeOfKey(key: StationKey): string {
  const n = key === 'Escape' ? 0 : Number(key.slice(1));
  return `%90%${String(n).padStart(2, '0')}`;
}

export function commandCodeOfDigit(digit: number): string {
  if (!Number.isInteger(digit) || digit < 0 || digit > 9) throw new RangeError(`숫자 명령은 0~9: ${digit}`);
  return `%91%${digit}`;
}

export function parseCommand(code: string): Command {
  const key = /^%90%(\d{2})$/.exec(code);
  if (key) {
    const n = Number(key[1]);
    const found = n === 0 ? 'Escape' : STATION_KEYS.find((k) => k === `F${n}`);
    if (found) return { kind: 'key', key: found };
  }
  const digit = /^%91%(\d)$/.exec(code);
  if (digit) return { kind: 'digit', digit: Number(digit[1]) };
  return { kind: 'unknown', code };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/station/keys.test.ts src/station/commandCode.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/station/keys.ts src/station/keys.test.ts src/station/commandCode.ts src/station/commandCode.test.ts src/core/hardware/scan/commandPrefix.ts
git commit -m "feat(warehouse-app): 스테이션 셸 키와 명령 바코드 코덱 — 숫자·기호만"
```

---

### Task 4: 작업 액션 레지스트리 + 기능키 캡처 (§5.2·§5.6)

**Files:**
- Create: `native/warehouse-app/src/station/actions.ts`
- Create: `native/warehouse-app/src/station/ActionRegistry.tsx`
- Create: `native/warehouse-app/src/station/useStationKeys.ts`
- Test: `native/warehouse-app/src/station/actions.test.ts`
- Test: `native/warehouse-app/src/station/useStationKeys.test.tsx`

**Interfaces:**
- Consumes: `StationKey`, `STATION_KEYS`, `stationKeyOf` (Task 3)
- Produces (`actions.ts`):
  - `interface ActionSpec { id: string; key: StationKey; label: string }`
  - `interface StationAction extends ActionSpec { enabled: boolean; run: () => void }`
  - `type KeyDispatch = { kind: 'run'; action: StationAction } | { kind: 'disabled'; action: StationAction } | { kind: 'none' }`
  - `assertUniqueKeys(actions: readonly ActionSpec[]): void`, `resolveActions(layers): Map<StationKey, StationAction>`, `dispatchKey(resolved, key): KeyDispatch`, `functionBarItems(resolved, omit: ReadonlySet<StationKey>): StationAction[]`, `actionsSignature(actions): string`
- Produces (`ActionRegistry.tsx`):
  - `ActionRegistryProvider({ children })`
  - `useStationActions(actions: readonly StationAction[]): void` — 셸 밖에서는 아무 일도 안 한다
  - `useDigitCommands(handler: ((digit: number) => void) | null): void` — 가장 안쪽 하나가 숫자 명령을 받는다
  - `useRegistryApi(): RegistryApi | null` — `RegistryApi.resolveKey(key): KeyDispatch`(최신 `run` 기준), `RegistryApi.digitHandler(): ((d: number) => void) | null`
  - `useResolvedActions(): ReadonlyMap<StationKey, StationAction>` — 기능키 바가 그릴 것
- Produces (`useStationKeys.ts`): `useStationKeyCapture(onRejected: () => void): void`

- [ ] **Step 1: 순수 함수 테스트**

`src/station/actions.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import {
  actionsSignature,
  assertUniqueKeys,
  dispatchKey,
  functionBarItems,
  resolveActions,
  type StationAction,
} from './actions';
import type { StationKey } from './keys';

const action = (id: string, key: StationKey, enabled = true): StationAction => ({
  id,
  key,
  label: id,
  enabled,
  run: vi.fn(),
});

describe('resolveActions', () => {
  it('같은 키면 안쪽 층(뒤)이 이긴다', () => {
    const resolved = resolveActions([[action('shell-f7', 'F7')], [action('screen-f7', 'F7')]]);
    expect(resolved.get('F7')?.id).toBe('screen-f7');
  });

  it('안쪽이 꺼져 있어도 이긴다 — 화면이 «지금은 안 된다» 고 한 키가 셸 동작으로 새지 않는다', () => {
    const resolved = resolveActions([[action('shell-f7', 'F7')], [action('screen-f7', 'F7', false)]]);
    expect(dispatchKey(resolved, 'F7')).toMatchObject({ kind: 'disabled', action: { id: 'screen-f7' } });
  });
});

describe('dispatchKey', () => {
  const resolved = resolveActions([[action('on', 'F7'), action('off', 'F8', false)]]);
  it.each([
    ['F7', 'run'],
    ['F8', 'disabled'],
    ['F9', 'none'],
  ] as const)('%s → %s', (key, kind) => {
    expect(dispatchKey(resolved, key).kind).toBe(kind);
  });
});

describe('functionBarItems', () => {
  it('켜진 것만, 키 순서대로, Esc 는 맨 끝, omit 한 키(탭)는 빼고', () => {
    const resolved = resolveActions([
      [action('tab-F1', 'F1')],
      [action('esc', 'Escape'), action('f12', 'F12'), action('f7', 'F7'), action('f9', 'F9', false)],
    ]);
    expect(functionBarItems(resolved, new Set<StationKey>(['F1'])).map((a) => a.id)).toEqual(['f7', 'f12', 'esc']);
  });
});

describe('assertUniqueKeys', () => {
  it('한 층에서 같은 키를 두 번 선언하면 던진다', () => {
    expect(() => assertUniqueKeys([action('a', 'F7'), action('b', 'F7')])).toThrow(/F7/);
  });
  it('다른 키면 통과', () => {
    expect(() => assertUniqueKeys([action('a', 'F7'), action('b', 'F8')])).not.toThrow();
  });
});

describe('actionsSignature', () => {
  it('run 만 바뀌면 같고, label·enabled 가 바뀌면 다르다', () => {
    const base = action('a', 'F7');
    expect(actionsSignature([base])).toBe(actionsSignature([{ ...base, run: () => {} }]));
    expect(actionsSignature([base])).not.toBe(actionsSignature([{ ...base, enabled: false }]));
    expect(actionsSignature([base])).not.toBe(actionsSignature([{ ...base, label: '다른 것' }]));
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/station/actions.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 순수 함수 구현**

`src/station/actions.ts`:

```ts
import { STATION_KEYS, type StationKey } from './keys';

/**
 * 화면이 한 번 선언하는 작업 액션(스펙 §5.2). 기능키 처리·기능키 바·명령 바코드·명령 시트가 모두 이 선언에서 파생된다.
 * 명령 바코드는 키에서 파생한다(`commandCodeOfKey`) — 바코드 = 그 키를 누른 것.
 */
export interface ActionSpec {
  id: string;
  key: StationKey;
  label: string;
}

export interface StationAction extends ActionSpec {
  enabled: boolean;
  run: () => void;
}

export type KeyDispatch =
  | { kind: 'run'; action: StationAction }
  | { kind: 'disabled'; action: StationAction }
  | { kind: 'none' };

/** 한 층 안에서 같은 키를 두 번 선언하면 어느 쪽이 도는지가 배열 순서에 달린다 — 선언 실수로 본다. */
export function assertUniqueKeys(actions: readonly ActionSpec[]): void {
  const seen = new Map<StationKey, string>();
  for (const action of actions) {
    const other = seen.get(action.key);
    if (other !== undefined) throw new Error(`같은 키 ${action.key} 를 두 액션(${other}, ${action.id})이 선언했다`);
    seen.set(action.key, action.id);
  }
}

/**
 * 층은 바깥(셸) → 안쪽(화면) 순서다. 같은 키면 안쪽이 이긴다 — 꺼져 있어도 이긴다:
 * 화면이 «지금은 안 된다» 고 한 키가 셸의 다른 동작으로 새면 안 된다.
 */
export function resolveActions(layers: readonly (readonly StationAction[])[]): Map<StationKey, StationAction> {
  const resolved = new Map<StationKey, StationAction>();
  for (const layer of layers) for (const action of layer) resolved.set(action.key, action);
  return resolved;
}

export function dispatchKey(resolved: ReadonlyMap<StationKey, StationAction>, key: StationKey): KeyDispatch {
  const action = resolved.get(key);
  if (!action) return { kind: 'none' };
  return action.enabled ? { kind: 'run', action } : { kind: 'disabled', action };
}

/**
 * 기능키 바: 켜진 것만(U2 — 지금 안 되는 것·권한 없는 것은 그리지 않는다), 키 순서(F1…F12, Esc 는 맨 끝).
 * `omit` 은 다른 곳에 이미 그려진 키다 — 탭 바의 F1~F6 을 바에 또 그리지 않는다.
 */
export function functionBarItems(
  resolved: ReadonlyMap<StationKey, StationAction>,
  omit: ReadonlySet<StationKey>
): StationAction[] {
  return STATION_KEYS.flatMap((key) => {
    const action = resolved.get(key);
    return action && action.enabled && !omit.has(key) ? [action] : [];
  });
}

/** 등록을 다시 알릴지 판단하는 서명 — `run` 은 렌더마다 새 함수라 빼고, 그리는 데 쓰는 값만 본다. */
export function actionsSignature(actions: readonly StationAction[]): string {
  return actions.map((a) => [a.id, a.key, a.label, a.enabled ? '1' : '0'].join('\u0000')).join('\u0001');
}
```

- [ ] **Step 4: 순수 함수 통과 확인**

Run: `npx vitest run src/station/actions.test.ts`
Expected: PASS

- [ ] **Step 5: 키 캡처 테스트**

`src/station/useStationKeys.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ActionRegistryProvider, useStationActions } from './ActionRegistry';
import type { StationAction } from './actions';
import { useStationKeyCapture } from './useStationKeys';

function Layer({ actions }: { actions: readonly StationAction[] }) {
  useStationActions(actions);
  return <input aria-label="입력" />;
}

function Harness({ actions, onRejected }: { actions: readonly StationAction[]; onRejected: () => void }) {
  useStationKeyCapture(onRejected);
  return <Layer actions={actions} />;
}

function setup(actions: readonly StationAction[], extra?: React.ReactNode) {
  const onRejected = vi.fn();
  render(
    <ActionRegistryProvider>
      <Harness actions={actions} onRejected={onRejected} />
      {extra}
    </ActionRegistryProvider>
  );
  return { onRejected, input: screen.getByLabelText('입력') };
}

const make = (key: StationAction['key'], enabled = true) => {
  const run = vi.fn();
  const action: StationAction = { id: `a-${key}`, key, label: key, enabled, run };
  return { action, run };
};

describe('useStationKeyCapture', () => {
  it('입력칸에 포커스가 있어도 기능키가 액션을 돌리고 기본 동작을 막는다', () => {
    const f7 = make('F7');
    const { input } = setup([f7.action]);
    input.focus();
    expect(fireEvent.keyDown(input, { key: 'F7' })).toBe(false);
    expect(f7.run).toHaveBeenCalledTimes(1);
  });

  it('액션이 없는 F5 도 막는다(웹뷰 새로고침) — 아무것도 돌리지 않고 오류도 아니다', () => {
    const { onRejected } = setup([]);
    expect(fireEvent.keyDown(window, { key: 'F5' })).toBe(false);
    expect(onRejected).not.toHaveBeenCalled();
  });

  it('꺼진 액션의 키는 돌리지 않고 거절을 알린다', () => {
    const f9 = make('F9', false);
    const { onRejected } = setup([f9.action]);
    fireEvent.keyDown(window, { key: 'F9' });
    expect(f9.run).not.toHaveBeenCalled();
    expect(onRejected).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['F4', { altKey: true }],
    ['F5', { ctrlKey: true }],
    ['F10', { shiftKey: true }],
  ] as const)('%s + 수식키 %o 는 건드리지 않는다(Alt+F4 로 창이 닫혀야 한다)', (key, mods) => {
    const target = make(key);
    setup([target.action]);
    expect(fireEvent.keyDown(window, { key, ...mods })).toBe(true);
    expect(target.run).not.toHaveBeenCalled();
  });

  it('누르고 있는 자동 반복은 한 번만 돌린다(반복 이벤트도 기본 동작은 막는다)', () => {
    const f7 = make('F7');
    setup([f7.action]);
    fireEvent.keyDown(window, { key: 'F7' });
    expect(fireEvent.keyDown(window, { key: 'F7', repeat: true })).toBe(false);
    expect(f7.run).toHaveBeenCalledTimes(1);
  });

  it('화면이 Esc 를 선언하지 않았으면 Esc 를 가져가지 않는다(입력칸·확인창의 기존 처리)', () => {
    setup([]);
    expect(fireEvent.keyDown(window, { key: 'Escape' })).toBe(true);
  });

  it('화면이 Esc 를 선언했으면 가져가 돌린다', () => {
    const esc = make('Escape');
    setup([esc.action]);
    expect(fireEvent.keyDown(window, { key: 'Escape' })).toBe(false);
    expect(esc.run).toHaveBeenCalledTimes(1);
  });

  it('확인창이 열려 있으면 Esc 는 확인창 몫, 기능키는 막기만 하고 돌리지 않는다', () => {
    const esc = make('Escape');
    const f10 = make('F10');
    setup([esc.action, f10.action], <div role="dialog" aria-modal="true" />);
    expect(fireEvent.keyDown(window, { key: 'Escape' })).toBe(true);
    expect(esc.run).not.toHaveBeenCalled();
    expect(fireEvent.keyDown(window, { key: 'F10' })).toBe(false);
    expect(f10.run).not.toHaveBeenCalled();
  });

  it('셸 밖(Provider 없음)에서는 useStationActions 가 아무 일도 하지 않는다 — 핸드헬드 공유 화면', () => {
    const f7 = make('F7');
    render(<Layer actions={[f7.action]} />);
    expect(fireEvent.keyDown(window, { key: 'F7' })).toBe(true);
    expect(f7.run).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: 실패 확인**

Run: `npx vitest run src/station/useStationKeys.test.tsx`
Expected: FAIL — `./ActionRegistry` 없음

- [ ] **Step 7: 레지스트리 구현**

`src/station/ActionRegistry.tsx`:

```tsx
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  actionsSignature,
  assertUniqueKeys,
  dispatchKey,
  resolveActions,
  type KeyDispatch,
  type StationAction,
} from './actions';
import type { StationKey } from './keys';

export interface RegistryApi {
  register(layerId: number, actions: readonly StationAction[]): void;
  unregister(layerId: number): void;
  setDigitHandler(layerId: number, handler: ((digit: number) => void) | null): void;
  /** 이벤트 처리기용 — 렌더와 무관하게 마지막 등록(최신 `run`)으로 판정한다. */
  resolveKey(key: StationKey): KeyDispatch;
  digitHandler(): ((digit: number) => void) | null;
}

const ApiContext = createContext<RegistryApi | null>(null);
const ResolvedContext = createContext<ReadonlyMap<StationKey, StationAction>>(new Map());

let nextLayerId = 0;
/**
 * 층 순서 = 첫 렌더 순서. 부모가 자식보다 먼저 렌더되므로 셸 < 화면이다.
 * (effect 는 자식이 먼저 돌아서 등록 순서로는 층을 정할 수 없다.)
 */
function useLayerId(): number {
  const [id] = useState(() => ++nextLayerId);
  return id;
}

function ordered<T>(map: ReadonlyMap<number, T>): T[] {
  return [...map.entries()].sort(([a], [b]) => a - b).map(([, value]) => value);
}

export function ActionRegistryProvider({ children }: { children: ReactNode }) {
  const layers = useRef(new Map<number, readonly StationAction[]>());
  const digits = useRef(new Map<number, (digit: number) => void>());
  const [resolved, setResolved] = useState<ReadonlyMap<StationKey, StationAction>>(() => new Map());

  const api = useMemo<RegistryApi>(() => {
    const current = () => resolveActions(ordered(layers.current));
    return {
      register(layerId, actions) {
        assertUniqueKeys(actions);
        const previous = layers.current.get(layerId);
        layers.current.set(layerId, actions);
        // 렌더마다 새 배열·새 run 이 와도 그리는 값이 같으면 다시 알리지 않는다 — 알리면 바가 매 렌더 다시 그려지고,
        // 등록하는 쪽이 바를 구독하면 무한 렌더가 된다. run 은 resolveKey 가 늘 최신 등록에서 꺼낸다.
        if (!previous || actionsSignature(previous) !== actionsSignature(actions)) setResolved(current());
      },
      unregister(layerId) {
        layers.current.delete(layerId);
        digits.current.delete(layerId);
        setResolved(current());
      },
      setDigitHandler(layerId, handler) {
        if (handler) digits.current.set(layerId, handler);
        else digits.current.delete(layerId);
      },
      resolveKey: (key) => dispatchKey(current(), key),
      digitHandler: () => ordered(digits.current).at(-1) ?? null,
    };
  }, []);

  return (
    <ApiContext.Provider value={api}>
      <ResolvedContext.Provider value={resolved}>{children}</ResolvedContext.Provider>
    </ApiContext.Provider>
  );
}

/**
 * 화면이 지금 상태의 액션을 선언한다(스펙 §5.2). 셸 밖(핸드헬드)에서는 아무 일도 하지 않으므로 공유 화면에서 불러도 된다.
 * 렌더마다 새 배열이어도 된다 — 그리는 값(id·key·label·enabled)이 같으면 바를 다시 그리지 않고 `run` 만 최신이 된다.
 */
export function useStationActions(actions: readonly StationAction[]): void {
  const api = useContext(ApiContext);
  const layerId = useLayerId();
  useEffect(() => {
    api?.register(layerId, actions);
  }, [api, layerId, actions]);
  useEffect(() => () => api?.unregister(layerId), [api, layerId]);
}

/** 숫자 명령(`%91%N`)을 받을 곳 — 「수량」 입력 중인 화면만 건다(스펙 §5.3). 가장 안쪽 하나만 받는다. */
export function useDigitCommands(handler: ((digit: number) => void) | null): void {
  const api = useContext(ApiContext);
  const layerId = useLayerId();
  useEffect(() => {
    api?.setDigitHandler(layerId, handler);
    return () => api?.setDigitHandler(layerId, null);
  }, [api, layerId, handler]);
}

export const useRegistryApi = (): RegistryApi | null => useContext(ApiContext);
export const useResolvedActions = (): ReadonlyMap<StationKey, StationAction> => useContext(ResolvedContext);
```

`src/station/useStationKeys.ts`:

```ts
import { useEffect } from 'react';
import { useRegistryApi } from './ActionRegistry';
import { stationKeyOf } from './keys';

/** 열린 확인창이 있으면 그 창이 키를 쓴다(취소 Esc 등) — 셸은 그 뒤의 화면 액션을 돌리지 않는다. */
function modalOpen(): boolean {
  return document.querySelector('[aria-modal="true"]') !== null;
}

/**
 * 창 수준 keydown «캡처 단계» 에서 F1~F12·Esc 를 처리한다(스펙 §5.6) — 입력칸에 포커스가 있어도 기능키는 동작해야 한다.
 * - F1~F12 는 처리 여부와 무관하게 기본 동작을 막는다: WebView2 의 F5 새로고침·F12 개발자 도구·F3 찾기·
 *   F7 캐럿 브라우징·F11 전체 화면. (릴리스 빌드에서 정말 막히는지는 실기 확인 대상 — 스펙 §10.3-1)
 * - Esc 는 화면이 Esc 액션을 선언했을 때만 가져간다 — 아니면 입력칸·확인창의 기존 Esc 처리에 맡긴다.
 * - 수식키가 붙은 조합(Alt+F4 등)은 건드리지 않고, 누르고 있는 자동 반복은 돌리지 않는다.
 */
export function useStationKeyCapture(onRejected: () => void): void {
  const api = useRegistryApi();
  useEffect(() => {
    if (!api) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const key = stationKeyOf(event);
      if (key === null) return;
      if (key === 'Escape' && (modalOpen() || api.resolveKey('Escape').kind === 'none')) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat || modalOpen()) return;
      const dispatch = api.resolveKey(key);
      if (dispatch.kind === 'run') dispatch.action.run();
      else if (dispatch.kind === 'disabled') onRejected();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [api, onRejected]);
}
```

- [ ] **Step 8: 통과 확인**

Run: `npx vitest run src/station/actions.test.ts src/station/useStationKeys.test.tsx && npx tsc -b`
Expected: PASS, 타입 에러 0

- [ ] **Step 9: Commit**

```bash
git add src/station/actions.ts src/station/actions.test.ts src/station/ActionRegistry.tsx src/station/useStationKeys.ts src/station/useStationKeys.test.tsx
git commit -m "feat(warehouse-app): 스테이션 작업 액션 레지스트리와 기능키 캡처"
```

---

### Task 5: 스캔 버스에서 명령 바코드를 떼어 낸다 (§5.3)

**Files:**
- Modify: `native/warehouse-app/src/core/hardware/scan/ScanProvider.tsx`
- Modify: `native/warehouse-app/src/core/hardware/scan/useScanner.ts`
- Test: `native/warehouse-app/src/core/hardware/scan/ScanProvider.test.tsx` (추가)

**Interfaces:**
- Consumes: `isCommandCode` (Task 3, `core/hardware/scan/commandPrefix.ts`)
- Produces:
  - `ScanBus.observe(handler): () => void` — 일반 구독자보다 **먼저** 받는다(명령 스캔은 받지 않는다)
  - `ScanBus.setCommandHandler(handler: (code: string) => void): () => void` — 명령 수신처는 하나. 없으면 명령 스캔은 버린다
  - `useScanObserver(handler: (e: ScanEvent) => void): void`, `useCommandScans(handler: (code: string) => void): void` (`useScanner.ts`)

- [ ] **Step 1: 실패하는 테스트**

`ScanProvider.test.tsx` 의 import 를 다음으로 바꾸고:

```tsx
import { useScanner, useScanEmit, useScanObserver, useCommandScans } from './useScanner';
```

파일 끝에 추가:

```tsx
function CommandProbe({ onCommand }: { onCommand: (code: string) => void }) {
  useCommandScans(onCommand);
  return null;
}

function scanKeys(code: string) {
  for (const key of [...code, 'Enter']) fireKey(key);
}

describe('명령 바코드(스테이션 UI 스펙 §5.3)', () => {
  it('% 로 시작하는 스캔은 일반 구독자에게 가지 않고 명령 수신처로 간다', () => {
    const scan = vi.fn();
    const command = vi.fn();
    render(
      <ScanProvider>
        <Probe onScan={scan} />
        <CommandProbe onCommand={command} />
      </ScanProvider>
    );
    scanKeys('%90%07');
    scanKeys('8801234');
    expect(command.mock.calls).toEqual([['%90%07']]);
    expect(scan.mock.calls).toEqual([['8801234']]);
  });

  it('명령 수신처가 없으면(핸드헬드) 명령 스캔은 버린다 — 송장·상품 조회로 새지 않는다', () => {
    const scan = vi.fn();
    render(
      <ScanProvider>
        <Probe onScan={scan} />
      </ScanProvider>
    );
    scanKeys('%90%03');
    expect(scan).not.toHaveBeenCalled();
  });

  it('카메라 스캔(emit)도 같은 규칙을 따른다', () => {
    const scan = vi.fn();
    const command = vi.fn();
    function Camera() {
      const emit = useScanEmit();
      return <button onClick={() => emit({ code: '%90%01', source: 'camera', at: 0 })}>카메라</button>;
    }
    render(
      <ScanProvider>
        <Probe onScan={scan} />
        <CommandProbe onCommand={command} />
        <Camera />
      </ScanProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: '카메라' }));
    expect(command).toHaveBeenCalledWith('%90%01');
    expect(scan).not.toHaveBeenCalled();
  });

  it('observe 는 같은 스캔의 일반 구독자보다 먼저 받는다', () => {
    const order: string[] = [];
    function Observer() {
      useScanObserver(() => order.push('observer'));
      return null;
    }
    // 일반 구독자를 먼저 마운트해도(effect 는 자식부터 돈다) observe 가 앞선다
    render(
      <ScanProvider>
        <Probe onScan={() => order.push('subscriber')} />
        <Observer />
      </ScanProvider>
    );
    scanKeys('8801234');
    expect(order).toEqual(['observer', 'subscriber']);
  });
});
```

(`Probe` 는 파일 위쪽에 이미 있다. `useScanObserver` 콜백은 렌더마다 새 함수지만 effect 가 다시 구독할 뿐 결과는 같다.)

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/core/hardware/scan/ScanProvider.test.tsx`
Expected: FAIL — `useCommandScans` 가 export 되지 않음

- [ ] **Step 3: 구현**

`ScanProvider.tsx` — import 와 버스를 다음으로 바꾼다(키보드 처리 `useEffect` 는 그대로):

```tsx
import { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import { createScanBuffer } from './scanBuffer';
import { isPreservedScanEnter } from './hidScanBoundary';
import { isCommandCode } from './commandPrefix';

export interface ScanEvent {
  code: string;
  source: 'hid' | 'camera';
  at: number;
}

type Handler = (e: ScanEvent) => void;
type CommandHandler = (code: string) => void;

interface ScanBus {
  subscribe(h: Handler): () => void;
  /** 일반 구독자보다 먼저 받는다 — «다음 스캔에서 지운다» 류(피드백 테두리)가 같은 스캔의 결과를 지우지 않게. */
  observe(h: Handler): () => void;
  /**
   * 명령 바코드(`%…`) 수신처. 하나뿐이다(스테이션 셸). 없으면 명령 스캔은 버린다 —
   * 일반 구독자(출고 화면은 모든 스캔을 송장으로 연다)에게는 어떤 경우에도 가지 않는다.
   */
  setCommandHandler(h: CommandHandler): () => void;
  emit(e: ScanEvent): void;
}

const ScanContext = createContext<ScanBus | null>(null);

export function ScanProvider({ children }: { children: React.ReactNode }) {
  const handlers = useRef(new Set<Handler>());
  const observers = useRef(new Set<Handler>());
  const commandHandler = useRef<CommandHandler | null>(null);

  const bus = useMemo<ScanBus>(
    () => ({
      subscribe(h) {
        handlers.current.add(h);
        return () => handlers.current.delete(h);
      },
      observe(h) {
        observers.current.add(h);
        return () => observers.current.delete(h);
      },
      setCommandHandler(h) {
        commandHandler.current = h;
        return () => {
          if (commandHandler.current === h) commandHandler.current = null;
        };
      },
      emit(e) {
        if (isCommandCode(e.code)) {
          commandHandler.current?.(e.code);
          return;
        }
        observers.current.forEach((h) => h(e));
        handlers.current.forEach((h) => h(e));
      },
    }),
    []
  );
```

(이하 `useEffect` 키보드 처리·return·`useScanBus` 는 바꾸지 않는다.)

`useScanner.ts` 끝에 추가:

```ts
/** 일반 구독자보다 먼저 받는다(명령 스캔 제외). 피드백 테두리 지우기처럼 «이 스캔이 왔다» 만 아는 쪽용. */
export function useScanObserver(handler: (e: ScanEvent) => void): void {
  const bus = useScanBus();
  useEffect(() => bus.observe(handler), [bus, handler]);
}

/** 명령 바코드를 받는다 — 스테이션 셸만 건다. */
export function useCommandScans(handler: (code: string) => void): void {
  const bus = useScanBus();
  useEffect(() => bus.setCommandHandler(handler), [bus, handler]);
}
```

- [ ] **Step 4: 통과 확인 + 스캔 관련 전부**

Run: `npx vitest run src/core/hardware/scan && npx tsc -b`
Expected: PASS(기존 스캔 테스트 포함), 타입 에러 0

- [ ] **Step 5: Commit**

```bash
git add src/core/hardware/scan/ScanProvider.tsx src/core/hardware/scan/useScanner.ts src/core/hardware/scan/ScanProvider.test.tsx
git commit -m "feat(warehouse-app): 스캔 버스가 명령 바코드를 일반 구독자에게서 떼어 낸다"
```

---

### Task 6: 피드백 — 소리·테두리·소리 설정 (§5.4)

**Files:**
- Create: `native/warehouse-app/src/station/feedback/tones.ts`
- Create: `native/warehouse-app/src/station/feedback/soundPrefs.ts`
- Create: `native/warehouse-app/src/station/feedback/soundPlayer.ts`
- Create: `native/warehouse-app/src/station/feedback/FeedbackProvider.tsx`
- Create: `native/warehouse-app/src/station/feedback/SoundSettings.tsx`
- Modify: `native/warehouse-app/src/app/routes/SettingsRoute.tsx`
- Test: `native/warehouse-app/src/station/feedback/soundPrefs.test.ts`
- Test: `native/warehouse-app/src/station/feedback/soundPlayer.test.ts`
- Test: `native/warehouse-app/src/station/feedback/FeedbackProvider.test.tsx`
- Test: `native/warehouse-app/src/station/feedback/SoundSettings.test.tsx`

**Interfaces:**
- Consumes: `useScanObserver` (Task 5), `DevicePrefs`·`localStoragePrefs`·`createMemoryPrefs` (`core/data/devicePrefs`)
- Produces:
  - `type FeedbackKind = 'success' | 'error' | 'complete' | 'command'`, `TONES: Record<FeedbackKind, readonly Tone[]>`
  - `interface Beep { frequency; wave: OscillatorType; at; duration; gain }`, `interface ToneSink { now(): number; beep(b: Beep): void }`, `createSoundPlayer({ sink, readPrefs })`, `createWebAudioSink(): ToneSink | null`, `defaultToneSink(): ToneSink | null`
  - `SOUND_VOLUME_KEY`, `SOUND_MUTED_KEY`, `interface SoundPrefs { volume: number /*0~100*/; muted: boolean }`, `readSoundPrefs(prefs)`, `writeSoundPrefs(prefs, next)`
  - `FeedbackProvider({ prefs?, sink?: ToneSink | null, children })` — `sink` 생략 = Web Audio, `null` = 무음
  - `useFeedback(): { signal(kind: FeedbackKind): void }` — 셸 밖에선 아무 일도 안 한다
  - `useFlash(): 'error' | 'complete' | null`

- [ ] **Step 1: 실패하는 테스트**

`src/station/feedback/soundPrefs.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createMemoryPrefs } from '../../core/data/devicePrefs';
import { DEFAULT_SOUND_PREFS, SOUND_MUTED_KEY, SOUND_VOLUME_KEY, readSoundPrefs, writeSoundPrefs } from './soundPrefs';

describe('소리 설정', () => {
  it('저장된 게 없으면 기본값', () => {
    expect(readSoundPrefs(createMemoryPrefs())).toEqual(DEFAULT_SOUND_PREFS);
  });

  it.each([
    ['abc', DEFAULT_SOUND_PREFS.volume],
    ['', DEFAULT_SOUND_PREFS.volume],
    ['150', 100],
    ['-3', 0],
    ['42.6', 43],
  ])('저장값 %j → 음량 %i', (stored, volume) => {
    expect(readSoundPrefs(createMemoryPrefs({ [SOUND_VOLUME_KEY]: stored })).volume).toBe(volume);
  });

  it('왕복한다', () => {
    const prefs = createMemoryPrefs();
    writeSoundPrefs(prefs, { volume: 35, muted: true });
    expect(prefs.get(SOUND_MUTED_KEY)).toBe('1');
    expect(readSoundPrefs(prefs)).toEqual({ volume: 35, muted: true });
  });
});
```

`src/station/feedback/soundPlayer.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createSoundPlayer, type Beep, type ToneSink } from './soundPlayer';
import type { SoundPrefs } from './soundPrefs';
import { TONES, type FeedbackKind } from './tones';

function recorder(now = 10) {
  const beeps: Beep[] = [];
  const sink: ToneSink = {
    now: () => now,
    beep: (b) => {
      beeps.push(b);
    },
  };
  return { beeps, sink };
}

const prefs = (p: SoundPrefs) => () => p;

describe('createSoundPlayer', () => {
  it('완료음은 두 음을 시작 시각에서 어긋나게, 음량 비례 이득으로 낸다', () => {
    const { beeps, sink } = recorder(10);
    createSoundPlayer({ sink, readPrefs: prefs({ volume: 50, muted: false }) }).play('complete');
    expect(beeps).toHaveLength(2);
    expect(beeps[0]).toMatchObject({ frequency: 1047, wave: 'sine', at: 10 });
    expect(beeps[0].gain).toBeCloseTo(0.15);
    expect(beeps[1].frequency).toBe(1568);
    expect(beeps[1].at).toBeCloseTo(10.12);
    expect(beeps[1].duration).toBeCloseTo(0.22);
  });

  it.each([
    { volume: 80, muted: true },
    { volume: 0, muted: false },
  ])('끄거나 음량 0 이면 소리를 내지 않는다 %o', (p) => {
    const { beeps, sink } = recorder();
    createSoundPlayer({ sink, readPrefs: prefs(p) }).play('error');
    expect(beeps).toHaveLength(0);
  });

  it('소리 장치가 없으면(jsdom·구형 웹뷰) 조용히 넘어간다', () => {
    expect(() => createSoundPlayer({ sink: null, readPrefs: prefs({ volume: 80, muted: false }) }).play('success')).not.toThrow();
  });

  it('네 소리는 서로 다르다 — 화면을 안 보고 구별해야 한다', () => {
    const kinds: FeedbackKind[] = ['success', 'error', 'complete', 'command'];
    const signatures = kinds.map((k) => JSON.stringify(TONES[k]));
    expect(new Set(signatures).size).toBe(4);
  });
});
```

`src/station/feedback/FeedbackProvider.test.tsx`:

```tsx
import { useCallback } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ScanProvider } from '../../core/hardware/scan/ScanProvider';
import { useScanner } from '../../core/hardware/scan/useScanner';
import { scanHid } from '../../core/hardware/scan/__fixtures__/hid';
import { createMemoryPrefs } from '../../core/data/devicePrefs';
import { FeedbackProvider, useFeedback, useFlash } from './FeedbackProvider';
import type { Beep, ToneSink } from './soundPlayer';
import { SOUND_MUTED_KEY } from './soundPrefs';
import type { FeedbackKind } from './tones';

function Probe({ onScanSignal }: { onScanSignal?: FeedbackKind }) {
  const { signal } = useFeedback();
  const flash = useFlash();
  useScanner(
    useCallback(() => {
      if (onScanSignal) signal(onScanSignal);
    }, [signal, onScanSignal])
  );
  return (
    <>
      <p data-testid="flash">{flash ?? 'none'}</p>
      <button onClick={() => signal('error')}>오류</button>
      <button onClick={() => signal('complete')}>완료</button>
    </>
  );
}

function setup(opts: { onScanSignal?: FeedbackKind; muted?: boolean } = {}) {
  const beeps: Beep[] = [];
  const sink: ToneSink = { now: () => 0, beep: (b) => void beeps.push(b) };
  const prefs = createMemoryPrefs(opts.muted ? { [SOUND_MUTED_KEY]: '1' } : {});
  render(
    <ScanProvider>
      <FeedbackProvider prefs={prefs} sink={sink}>
        <Probe onScanSignal={opts.onScanSignal} />
      </FeedbackProvider>
    </ScanProvider>
  );
  return { beeps };
}

describe('FeedbackProvider', () => {
  it('오류는 소리와 빨간 테두리, 다음 스캔에서 테두리가 사라진다', () => {
    const { beeps } = setup();
    fireEvent.click(screen.getByRole('button', { name: '오류' }));
    expect(screen.getByTestId('flash')).toHaveTextContent('error');
    expect(beeps.length).toBeGreaterThan(0);
    scanHid(document.body, '8801234');
    expect(screen.getByTestId('flash')).toHaveTextContent('none');
  });

  it('완료는 초록', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: '완료' }));
    expect(screen.getByTestId('flash')).toHaveTextContent('complete');
  });

  it('화면이 «그 스캔» 의 처리에서 낸 오류는 같은 스캔이 지우지 않는다', () => {
    setup({ onScanSignal: 'error' });
    scanHid(document.body, '8801234');
    expect(screen.getByTestId('flash')).toHaveTextContent('error');
  });

  it('소리를 꺼도 테두리는 남는다', () => {
    const { beeps } = setup({ muted: true });
    fireEvent.click(screen.getByRole('button', { name: '오류' }));
    expect(beeps).toHaveLength(0);
    expect(screen.getByTestId('flash')).toHaveTextContent('error');
  });

  it('셸 밖(핸드헬드)에서 useFeedback 은 아무 일도 하지 않는다', () => {
    function Bare() {
      const { signal } = useFeedback();
      return <button onClick={() => signal('error')}>신호</button>;
    }
    render(<Bare />);
    expect(() => fireEvent.click(screen.getByRole('button', { name: '신호' }))).not.toThrow();
  });
});
```

`src/station/feedback/SoundSettings.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ScanProvider } from '../../core/hardware/scan/ScanProvider';
import { createMemoryPrefs } from '../../core/data/devicePrefs';
import { FeedbackProvider } from './FeedbackProvider';
import { SoundSettings } from './SoundSettings';
import type { Beep, ToneSink } from './soundPlayer';
import { SOUND_MUTED_KEY, SOUND_VOLUME_KEY } from './soundPrefs';

describe('SoundSettings', () => {
  it('음량을 저장하고, 손을 떼면 그 음량으로 한 번 들려준다', () => {
    const beeps: Beep[] = [];
    const sink: ToneSink = { now: () => 0, beep: (b) => void beeps.push(b) };
    const prefs = createMemoryPrefs();
    render(
      <ScanProvider>
        <FeedbackProvider prefs={prefs} sink={sink}>
          <SoundSettings prefs={prefs} />
        </FeedbackProvider>
      </ScanProvider>
    );
    const slider = screen.getByRole('slider', { name: '음량' });
    fireEvent.change(slider, { target: { value: '40' } });
    expect(prefs.get(SOUND_VOLUME_KEY)).toBe('40');
    fireEvent.pointerUp(slider);
    expect(beeps).toHaveLength(1);
    expect(beeps[0].gain).toBeCloseTo(0.4 * 0.3);

    fireEvent.click(screen.getByRole('checkbox', { name: '끄기' }));
    expect(prefs.get(SOUND_MUTED_KEY)).toBe('1');
    expect(slider).toBeDisabled();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/station/feedback`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`src/station/feedback/tones.ts`:

```ts
export type FeedbackKind = 'success' | 'error' | 'complete' | 'command';

export interface Tone {
  frequency: number;
  wave: OscillatorType;
  startMs: number;
  durationMs: number;
}

/**
 * 네 가지 소리(스펙 §5.4). 화면을 안 보고 구별할 수 있어야 한다:
 * 성공 = 짧고 높게, 오류 = 낮은 사각파 두 번, 완료 = 올라가는 두 음, 명령 = 아주 짧은 딸깍.
 */
export const TONES: Record<FeedbackKind, readonly Tone[]> = {
  success: [{ frequency: 1760, wave: 'sine', startMs: 0, durationMs: 70 }],
  error: [
    { frequency: 220, wave: 'square', startMs: 0, durationMs: 160 },
    { frequency: 220, wave: 'square', startMs: 220, durationMs: 160 },
  ],
  complete: [
    { frequency: 1047, wave: 'sine', startMs: 0, durationMs: 110 },
    { frequency: 1568, wave: 'sine', startMs: 120, durationMs: 220 },
  ],
  command: [{ frequency: 2637, wave: 'triangle', startMs: 0, durationMs: 35 }],
};
```

`src/station/feedback/soundPrefs.ts`:

```ts
import type { DevicePrefs } from '../../core/data/devicePrefs';

export const SOUND_VOLUME_KEY = 'almondwms.station.soundVolume';
export const SOUND_MUTED_KEY = 'almondwms.station.soundMuted';

export interface SoundPrefs {
  /** 0~100 */
  volume: number;
  muted: boolean;
}

export const DEFAULT_SOUND_PREFS: SoundPrefs = { volume: 80, muted: false };

const clampVolume = (n: number) => Math.min(100, Math.max(0, Math.round(n)));

export function readSoundPrefs(prefs: DevicePrefs): SoundPrefs {
  const stored = prefs.get(SOUND_VOLUME_KEY);
  const n = stored === null || stored.trim() === '' ? Number.NaN : Number(stored);
  return {
    volume: Number.isFinite(n) ? clampVolume(n) : DEFAULT_SOUND_PREFS.volume,
    muted: prefs.get(SOUND_MUTED_KEY) === '1',
  };
}

export function writeSoundPrefs(prefs: DevicePrefs, next: SoundPrefs): void {
  prefs.set(SOUND_VOLUME_KEY, String(clampVolume(next.volume)));
  prefs.set(SOUND_MUTED_KEY, next.muted ? '1' : '0');
}
```

`src/station/feedback/soundPlayer.ts`:

```ts
import type { SoundPrefs } from './soundPrefs';
import { TONES, type FeedbackKind } from './tones';

export interface Beep {
  frequency: number;
  wave: OscillatorType;
  /** 초(AudioContext.currentTime 기준) */
  at: number;
  /** 초 */
  duration: number;
  gain: number;
}

/** 소리를 내는 바닥. Web Audio 구현과 테스트 기록기가 같은 모양을 쓴다. */
export interface ToneSink {
  now(): number;
  beep(beep: Beep): void;
}

/** 음량 100 일 때의 이득. 사각파(오류음)는 같은 이득에서 훨씬 크게 들리고, 1 에 가까우면 찢어진다. */
const MAX_GAIN = 0.3;

export function createSoundPlayer(deps: { sink: ToneSink | null; readPrefs: () => SoundPrefs }) {
  return {
    play(kind: FeedbackKind): void {
      const sink = deps.sink;
      if (!sink) return;
      const { volume, muted } = deps.readPrefs();
      if (muted || volume <= 0) return;
      const start = sink.now();
      for (const tone of TONES[kind])
        sink.beep({
          frequency: tone.frequency,
          wave: tone.wave,
          at: start + tone.startMs / 1000,
          duration: tone.durationMs / 1000,
          gain: (volume / 100) * MAX_GAIN,
        });
    },
  };
}

/** WebView2(Chromium) 의 Web Audio. AudioContext 가 없으면(jsdom) null — 소리 없이 동작한다. */
export function createWebAudioSink(): ToneSink | null {
  if (typeof window === 'undefined' || typeof window.AudioContext !== 'function') return null;
  const Ctor = window.AudioContext;
  let context: AudioContext | null = null;
  const get = () => (context ??= new Ctor());
  return {
    now: () => get().currentTime,
    beep({ frequency, wave, at, duration, gain }) {
      const ctx = get();
      // 자동재생 정책: 첫 사용자 입력 전에는 suspended 다. 스캐너 키 입력도 사용자 입력이다(실기 확인 §10.3-3).
      if (ctx.state === 'suspended') void ctx.resume();
      const oscillator = ctx.createOscillator();
      const amp = ctx.createGain();
      oscillator.type = wave;
      oscillator.frequency.value = frequency;
      amp.gain.setValueAtTime(gain, at);
      // 0 으로 끊으면 «틱» 잡음이 난다 — 지수 감쇠로 닫는다(0 은 지수 램프의 목표가 될 수 없다).
      amp.gain.exponentialRampToValueAtTime(0.0001, at + duration);
      oscillator.connect(amp).connect(ctx.destination);
      oscillator.start(at);
      oscillator.stop(at + duration);
    },
  };
}

let shared: ToneSink | null | undefined;
/** 앱 전체에 AudioContext 하나 — 셸이 다시 붙어도(재로그인) 새로 만들지 않는다. */
export function defaultToneSink(): ToneSink | null {
  if (shared === undefined) shared = createWebAudioSink();
  return shared;
}
```

`src/station/feedback/FeedbackProvider.tsx`:

```tsx
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { localStoragePrefs, type DevicePrefs } from '../../core/data/devicePrefs';
import { useScanObserver } from '../../core/hardware/scan/useScanner';
import { createSoundPlayer, defaultToneSink, type ToneSink } from './soundPlayer';
import { readSoundPrefs } from './soundPrefs';
import type { FeedbackKind } from './tones';

export type Flash = 'error' | 'complete' | null;

interface FeedbackApi {
  signal(kind: FeedbackKind): void;
}

const SignalContext = createContext<FeedbackApi>({ signal: () => {} });
const FlashContext = createContext<Flash>(null);

/**
 * 스캔 결과를 화면을 안 보고도 알게 한다(스펙 §5.4): 소리 넷 + 화면 테두리(오류 빨강·완료 초록).
 * 테두리는 다음 스캔에서 사라진다 — 버스의 observe 로 일반 구독자보다 먼저 지우므로, 화면이 그 스캔을
 * 처리하며 낸 오류는 남는다. 명령 스캔은 버스가 따로 보내므로 셸이 signal('command') 로 지운다.
 */
export function FeedbackProvider({
  prefs = localStoragePrefs,
  sink,
  children,
}: {
  prefs?: DevicePrefs;
  /** 생략하면 Web Audio, null 이면 무음(테스트). */
  sink?: ToneSink | null;
  children: ReactNode;
}) {
  const [flash, setFlash] = useState<Flash>(null);
  const api = useMemo<FeedbackApi>(() => {
    const player = createSoundPlayer({
      sink: sink === undefined ? defaultToneSink() : sink,
      readPrefs: () => readSoundPrefs(prefs),
    });
    return {
      signal(kind) {
        player.play(kind);
        setFlash(kind === 'error' ? 'error' : kind === 'complete' ? 'complete' : null);
      },
    };
  }, [sink, prefs]);
  useScanObserver(useCallback(() => setFlash(null), []));
  return (
    <SignalContext.Provider value={api}>
      <FlashContext.Provider value={flash}>{children}</FlashContext.Provider>
    </SignalContext.Provider>
  );
}

/** 셸 밖(핸드헬드)에서는 아무 일도 하지 않는다 — 공유 화면이 불러도 된다. */
export const useFeedback = (): FeedbackApi => useContext(SignalContext);
export const useFlash = (): Flash => useContext(FlashContext);
```

`src/station/feedback/SoundSettings.tsx`:

```tsx
import { useState } from 'react';
import { localStoragePrefs, type DevicePrefs } from '../../core/data/devicePrefs';
import { useFeedback } from './FeedbackProvider';
import { readSoundPrefs, writeSoundPrefs, type SoundPrefs } from './soundPrefs';

/** 설정 화면의 「소리」 절(스테이션 전용). 음량을 바꾸고 손을 떼면 그 음량으로 한 번 들려준다. */
export function SoundSettings({ prefs = localStoragePrefs }: { prefs?: DevicePrefs }) {
  const [sound, setSound] = useState<SoundPrefs>(() => readSoundPrefs(prefs));
  const { signal } = useFeedback();
  const update = (next: SoundPrefs) => {
    writeSoundPrefs(prefs, next);
    setSound(next);
  };
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-gray-700">소리</h2>
      <div className="flex items-center gap-4">
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          aria-label="음량"
          value={sound.volume}
          disabled={sound.muted}
          onChange={(e) => update({ ...sound, volume: Number(e.target.value) })}
          onPointerUp={() => signal('success')}
          onKeyUp={() => signal('success')}
        />
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={sound.muted} onChange={(e) => update({ ...sound, muted: e.target.checked })} />
          끄기
        </label>
      </div>
    </section>
  );
}
```

`SettingsRoute.tsx` — import 추가 후 `{isStationDevice() && <LabelPrinterSettings />}` 를 다음으로 바꾼다:

```tsx
import { SoundSettings } from '../../station/feedback/SoundSettings';
```

```tsx
      {isStationDevice() && (
        <>
          <LabelPrinterSettings />
          <SoundSettings />
        </>
      )}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/station/feedback src/app && npx tsc -b`
Expected: PASS, 타입 에러 0

- [ ] **Step 5: Commit**

```bash
git add src/station/feedback src/app/routes/SettingsRoute.tsx
git commit -m "feat(warehouse-app): 스테이션 피드백 — 소리 넷과 화면 테두리, 음량 설정"
```

---

### Task 7: 상태바 — 프린터·서버·미전송·배치 (§5.5)

**Files:**
- Create: `native/warehouse-app/src/core/hardware/print/printerStatus.ts`
- Modify: `native/warehouse-app/src/core/hardware/print/labelPrinter.ts` (`printRaw`, `writeLabelPrinter`)
- Create: `native/warehouse-app/src/core/data/serverStatus.ts`
- Modify: `native/warehouse-app/src/core/data/httpClient.ts` (`once`)
- Create: `native/warehouse-app/src/station/status/statusBar.ts`
- Create: `native/warehouse-app/src/station/status/batchProgress.tsx`
- Create: `native/warehouse-app/src/station/status/StatusBar.tsx`
- Test: `native/warehouse-app/src/core/hardware/print/labelPrinter.test.ts` (추가)
- Test: `native/warehouse-app/src/core/data/httpClient.test.ts` (추가)
- Test: `native/warehouse-app/src/station/status/statusBar.test.ts`
- Test: `native/warehouse-app/src/station/status/StatusBar.test.tsx`

**Interfaces:**
- Consumes: `TabKey` (Task 3), `StoredOperation` (`core/operations/operationStore`), `useWorkRuntime` (`core/operations/OperationContext`), `readLabelPrinter` (`core/hardware/print/labelPrinter`)
- Produces:
  - `reportPrintOutcome(ok: boolean)`, `resetPrintOutcome()`, `subscribePrintOutcome(fn): () => void`, `printerStatusVersion(): number`(스냅숏용 판수), `lastPrintFailed(): boolean`
  - `type ServerReach = 'unknown' | 'up' | 'down'`, `reportServerReach(next: 'up' | 'down')`, `subscribeServerReach(fn): () => void`, `currentServerReach(): ServerReach`
  - `interface BatchProgress { code: string; done: number; total: number }`, `statusBarItems(input: StatusInput): StatusItem[]`, `unsentCount(ops, now): number`, `UNSENT_AFTER_MS = 1500`
  - `BatchProgressProvider`, `useBatchProgress(progress: BatchProgress | null): void`(F1·F2 화면이 PR C 에서 부른다), `useCurrentBatchProgress()`
  - `StatusBar({ tab: TabKey | null; prefs?: DevicePrefs })`

- [ ] **Step 1: 실패하는 테스트**

`src/station/status/statusBar.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { StoredOperation } from '../../core/operations/operationStore';
import { statusBarItems, unsentCount, type StatusInput } from './statusBar';

const base: StatusInput = {
  printer: { configured: true, lastFailed: false },
  server: 'up',
  unsent: 0,
  batch: null,
  tab: 'F1',
};
const tones = (input: StatusInput) => Object.fromEntries(statusBarItems(input).map((i) => [i.id, i.tone]));
const labels = (input: StatusInput) => statusBarItems(input).map((i) => i.label);

describe('statusBarItems', () => {
  it.each([
    [{ configured: true, lastFailed: false }, 'ok'],
    [{ configured: false, lastFailed: false }, 'bad'],
    [{ configured: true, lastFailed: true }, 'bad'],
  ])('프린터 %o → %s', (printer, tone) => {
    expect(tones({ ...base, printer }).printer).toBe(tone);
  });

  it.each([
    ['up', 'ok'],
    ['down', 'bad'],
    ['unknown', 'idle'],
  ] as const)('서버 %s → %s (모르는 상태를 초록으로 그리지 않는다)', (server, tone) => {
    expect(tones({ ...base, server }).server).toBe(tone);
  });

  it('미전송은 1 이상일 때만 노랑', () => {
    expect(labels(base)).not.toContain('미전송 0');
    expect(statusBarItems({ ...base, unsent: 3 })).toContainEqual({ id: 'unsent', label: '미전송 3', tone: 'warn' });
  });

  it.each([
    ['F1', true],
    ['F2', true],
    ['F3', false],
    [null, false],
  ] as const)('배치 진행은 F1·F2 에서만 (%s → %s)', (tab, shown) => {
    const items = labels({ ...base, tab, batch: { code: 'B-1002', done: 13, total: 40 } });
    expect(items.includes('B-1002 13/40')).toBe(shown);
  });

  it('스캐너 칸은 없다 — HID 리더기는 연결 여부를 알 수 없다', () => {
    expect(statusBarItems(base).map((i) => i.id)).toEqual(['printer', 'server']);
  });
});

describe('unsentCount', () => {
  const op = (status: StoredOperation['status'], createdAt: number): StoredOperation => ({
    id: `${status}-${createdAt}`,
    scope: 's',
    resource: 'r',
    method: 'POST',
    path: '/shipments/x/simple-outbound-scans',
    bodyJson: '{}',
    createdAt,
    status,
    attempts: 1,
  });

  it('보내는 중 1.5초 안은 세지 않고(깜빡임), 넘거나 불확실하면 센다', () => {
    const now = 10_000;
    expect(unsentCount([op('sending', now - 200)], now)).toBe(0);
    expect(unsentCount([op('queued', now - 1500)], now)).toBe(1);
    expect(unsentCount([op('uncertain', now - 10)], now)).toBe(1);
  });
});
```

`src/station/status/StatusBar.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { createMemoryPrefs } from '../../core/data/devicePrefs';
import { reportServerReach } from '../../core/data/serverStatus';
import { LABEL_PRINTER_KEY, writeLabelPrinter } from '../../core/hardware/print/labelPrinter';
import { reportPrintOutcome, resetPrintOutcome } from '../../core/hardware/print/printerStatus';
import { OperationContext, type WorkRuntime } from '../../core/operations/OperationContext';
import type { StoredOperation } from '../../core/operations/operationStore';
import { BatchProgressProvider, useBatchProgress } from './batchProgress';
import { StatusBar } from './StatusBar';

const toneOf = (label: string) => screen.getByText(label).closest('[data-tone]')?.getAttribute('data-tone');

function Batch() {
  useBatchProgress({ code: 'B-1002', done: 13, total: 40 });
  return null;
}

describe('StatusBar', () => {
  it('프린터: 미설정이면 빨강, 설정하면 초록, 출력 실패 뒤 빨강, 다시 설정하면 초록', () => {
    resetPrintOutcome();
    const prefs = createMemoryPrefs();
    render(<StatusBar tab="F1" prefs={prefs} />);
    expect(toneOf('프린터')).toBe('bad');
    act(() => writeLabelPrinter(prefs, 'XP-DT108B'));
    expect(toneOf('프린터')).toBe('ok');
    act(() => reportPrintOutcome(false));
    expect(toneOf('프린터')).toBe('bad');
    act(() => writeLabelPrinter(prefs, 'XP-DT108B'));
    expect(toneOf('프린터')).toBe('ok');
  });

  it('서버: 마지막 요청이 서버에 못 닿았으면 빨강', () => {
    render(<StatusBar tab="F1" prefs={createMemoryPrefs({ [LABEL_PRINTER_KEY]: 'spooler://P' })} />);
    act(() => reportServerReach('down'));
    expect(toneOf('서버')).toBe('bad');
    act(() => reportServerReach('up'));
    expect(toneOf('서버')).toBe('ok');
  });

  it('미전송 오퍼레이션이 있으면 미전송 N', () => {
    const op: StoredOperation = {
      id: 'op-1',
      scope: 's',
      resource: 'r',
      method: 'POST',
      path: '/shipments/x/simple-outbound-scans',
      bodyJson: '{}',
      createdAt: Date.now() - 5000,
      status: 'queued',
      attempts: 1,
    };
    const snapshot = [op]; // useSyncExternalStore 는 같은 참조를 돌려받아야 한다
    const runtime = {
      runner: { subscribe: () => () => {}, getSnapshot: () => snapshot },
      store: {},
      getScope: async () => 's',
    } as unknown as WorkRuntime;
    render(
      <OperationContext.Provider value={runtime}>
        <StatusBar tab="F3" prefs={createMemoryPrefs()} />
      </OperationContext.Provider>
    );
    expect(screen.getByText('미전송 1')).toBeInTheDocument();
  });

  it('배치 진행은 F1 에서 보이고 F3 에서는 없다', () => {
    const { rerender } = render(
      <BatchProgressProvider>
        <Batch />
        <StatusBar tab="F1" prefs={createMemoryPrefs()} />
      </BatchProgressProvider>
    );
    expect(screen.getByText('B-1002 13/40')).toBeInTheDocument();
    rerender(
      <BatchProgressProvider>
        <Batch />
        <StatusBar tab="F3" prefs={createMemoryPrefs()} />
      </BatchProgressProvider>
    );
    expect(screen.queryByText('B-1002 13/40')).toBeNull();
  });
});
```

`labelPrinter.test.ts` 끝에 추가(import 에 `lastPrintFailed` 를 `./printerStatus` 에서 가져온다):

```ts
import { lastPrintFailed } from './printerStatus';

describe('출력 결과 기록(상태바 «프린터»)', () => {
  beforeEach(() => invokeMock.mockReset());

  it('보내지 못하면 실패로, 보내면 성공으로 남는다', async () => {
    invokeMock.mockRejectedValueOnce('spooler offline');
    await expect(printRaw('spooler://P', '^XA^XZ')).rejects.toBeInstanceOf(PrinterError);
    expect(lastPrintFailed()).toBe(true);
    invokeMock.mockResolvedValueOnce(undefined);
    await printRaw('spooler://P', '^XA^XZ');
    expect(lastPrintFailed()).toBe(false);
  });

  it('프린터 설정을 바꾸면 옛 프린터의 실패는 지운다', async () => {
    invokeMock.mockRejectedValueOnce('spooler offline');
    await expect(printRaw('spooler://P', '^XA^XZ')).rejects.toBeInstanceOf(PrinterError);
    writeLabelPrinter(createMemoryPrefs(), 'XP-DT108B');
    expect(lastPrintFailed()).toBe(false);
  });
});
```

`httpClient.test.ts` 끝에 추가(import 에 `currentServerReach` 를 `./serverStatus` 에서):

```ts
import { currentServerReach } from './serverStatus';

describe('서버 도달 기록(상태바 «서버»)', () => {
  it('fetch 가 던지면 down, 응답이 오면(4xx 여도) up', async () => {
    const doFetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('network'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 'NOT_FOUND' }), { status: 404 }));
    const api = createApiClient({
      baseUrl: 'https://core.test',
      getToken: async () => 't',
      authMode: 'bearer',
      doFetch: doFetch as never,
    });
    await expect(api.request({ path: '/x' })).rejects.toThrow('network');
    expect(currentServerReach()).toBe('down');
    await expect(api.request({ path: '/x' })).rejects.toBeInstanceOf(ApiError);
    expect(currentServerReach()).toBe('up');
  });
});
```

(`ApiError`·`createApiClient` 가 그 파일에서 이미 import 돼 있지 않으면 `./httpClient` 에서 더한다.)

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/station/status src/core/hardware/print/labelPrinter.test.ts src/core/data/httpClient.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 상태 원천 구현**

`src/core/hardware/print/printerStatus.ts`:

```ts
/**
 * 마지막 출력 결과 — 스테이션 상태바의 «프린터» 칸(스펙 §5.5)이 읽는다.
 * 앱의 모든 출력은 `printRaw` 를 지나므로 거기서 적는다. 프린터 설정을 바꾸면 옛 결과는 의미가 없어 지운다.
 */
let lastFailed = false;
// 바뀔 때마다 오르는 판수 — 상태바는 이걸 useSyncExternalStore 의 스냅숏으로 쓴다. `lastFailed` 를 스냅숏으로 쓰면
// 프린터를 새로 설정할 때(false → false) 다시 그려지지 않아, 설정했는데도 «미설정» 빨강이 남는다.
let version = 0;
const listeners = new Set<() => void>();
const emit = () => {
  version++;
  listeners.forEach((listener) => listener());
};

export function reportPrintOutcome(ok: boolean): void {
  lastFailed = !ok;
  emit();
}

/** 프린터 설정이 바뀌었다 — 옛 실패를 지우고, 설정 여부를 다시 읽게 알린다. */
export function resetPrintOutcome(): void {
  lastFailed = false;
  emit();
}

export function subscribePrintOutcome(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function printerStatusVersion(): number {
  return version;
}

export function lastPrintFailed(): boolean {
  return lastFailed;
}
```

`labelPrinter.ts` — import 추가, `writeLabelPrinter`·`printRaw` 교체:

```ts
import { reportPrintOutcome, resetPrintOutcome } from './printerStatus';
```

```ts
export function writeLabelPrinter(prefs: DevicePrefs, name: string): void {
  // 붙여 넣은 `spooler://` 를 벗겨야 접두어가 겹치지 않는다 — 겹치면 인쇄가 전부 실패한다.
  const bare = printerNameOf(name.trim()).trim();
  if (!bare) prefs.remove(LABEL_PRINTER_KEY);
  else prefs.set(LABEL_PRINTER_KEY, `${SPOOLER}${bare}`);
  resetPrintOutcome();
}
```

```ts
export const printRaw: PrintRaw = async (target, text) => {
  try {
    await invoke('print_raw', {
      target,
      data: Array.from(new TextEncoder().encode(text)),
    });
  } catch (error) {
    reportPrintOutcome(false);
    throw new PrinterError(String(error));
  }
  reportPrintOutcome(true);
};
```

`src/core/data/serverStatus.ts`:

```ts
/**
 * 마지막 요청이 서버에 닿았는가 — 스테이션 상태바의 «서버» 칸(스펙 §5.5).
 * 응답이 오면(4xx·5xx 여도) 닿은 것이고, fetch 자체가 던지면(네트워크·시간 초과) 못 닿은 것이다.
 * 이 파일은 루트 core 통합 스펙이 httpClient 를 통해 함께 불러온다 — 브라우저 전용 API 를 쓰지 말 것.
 */
export type ServerReach = 'unknown' | 'up' | 'down';

let reach: ServerReach = 'unknown';
const listeners = new Set<() => void>();

export function reportServerReach(next: 'up' | 'down'): void {
  if (reach === next) return;
  reach = next;
  listeners.forEach((listener) => listener());
}

export function subscribeServerReach(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function currentServerReach(): ServerReach {
  return reach;
}
```

`httpClient.ts` — import 추가 후 `once` 안의 `try { return await doFetch(...) } finally { … }` 를 다음으로:

```ts
import { reportServerReach } from './serverStatus';
```

```ts
    try {
      const res = await doFetch(`${deps.baseUrl}${opts.path}`, {
        method: opts.method,
        signal: controller.signal,
        headers,
        body:
          opts.bodyJson ??
          (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
      });
      reportServerReach('up');
      return res;
    } catch (error) {
      reportServerReach('down');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
```

- [ ] **Step 4: 상태바 구현**

`src/station/status/statusBar.ts`:

```ts
import type { ServerReach } from '../../core/data/serverStatus';
import type { StoredOperation } from '../../core/operations/operationStore';
import type { TabKey } from '../keys';

export type StatusTone = 'ok' | 'bad' | 'warn' | 'idle';

export interface StatusItem {
  id: 'printer' | 'server' | 'unsent' | 'batch';
  label: string;
  tone: StatusTone;
}

export interface BatchProgress {
  code: string;
  done: number;
  total: number;
}

export interface StatusInput {
  printer: { configured: boolean; lastFailed: boolean };
  server: ServerReach;
  unsent: number;
  batch: BatchProgress | null;
  tab: TabKey | null;
}

/** 보내는 중인 오퍼레이션은 이 시간이 지나거나 불확실해져야 «미전송» 이다 — 정상 전송의 깜빡임을 막는다(workStatus 와 같은 1.5초). */
export const UNSENT_AFTER_MS = 1500;

export function unsentCount(operations: readonly StoredOperation[], now: number): number {
  return operations.filter((o) => o.status === 'uncertain' || now - o.createdAt >= UNSENT_AFTER_MS).length;
}

/**
 * 상태바 칸(스펙 §5.5). 프린터·서버는 늘 점으로, 미전송은 1 이상일 때만, 배치 진행은 F1·F2 에서만.
 * 스캐너 칸은 없다 — HID 리더기는 키보드라 연결 여부를 앱이 알 수 없고, 모르는 상태를 초록으로 그리지 않는다.
 */
export function statusBarItems(input: StatusInput): StatusItem[] {
  const items: StatusItem[] = [
    {
      id: 'printer',
      label: '프린터',
      tone: input.printer.configured && !input.printer.lastFailed ? 'ok' : 'bad',
    },
    {
      id: 'server',
      label: '서버',
      tone: input.server === 'up' ? 'ok' : input.server === 'down' ? 'bad' : 'idle',
    },
  ];
  if (input.unsent > 0) items.push({ id: 'unsent', label: `미전송 ${input.unsent}`, tone: 'warn' });
  if (input.batch && (input.tab === 'F1' || input.tab === 'F2'))
    items.push({ id: 'batch', label: `${input.batch.code} ${input.batch.done}/${input.batch.total}`, tone: 'idle' });
  return items;
}
```

`src/station/status/batchProgress.tsx`:

```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { BatchProgress } from './statusBar';

const SetContext = createContext<((progress: BatchProgress | null) => void) | null>(null);
const ValueContext = createContext<BatchProgress | null>(null);

export function BatchProgressProvider({ children }: { children: ReactNode }) {
  const [progress, setProgress] = useState<BatchProgress | null>(null);
  return (
    <SetContext.Provider value={setProgress}>
      <ValueContext.Provider value={progress}>{children}</ValueContext.Provider>
    </SetContext.Provider>
  );
}

/** F1·F2 화면이 지금 배치의 진행을 상태바에 올린다(스펙 §5.5). 화면이 사라지면 지운다. 셸 밖에선 아무 일도 안 한다. */
export function useBatchProgress(progress: BatchProgress | null): void {
  const set = useContext(SetContext);
  const code = progress?.code ?? null;
  const done = progress?.done ?? 0;
  const total = progress?.total ?? 0;
  useEffect(() => {
    set?.(code === null ? null : { code, done, total });
  }, [set, code, done, total]);
  useEffect(() => () => set?.(null), [set]);
}

export const useCurrentBatchProgress = (): BatchProgress | null => useContext(ValueContext);
```

`src/station/status/StatusBar.tsx`:

```tsx
import { useEffect, useState, useSyncExternalStore } from 'react';
import { cn } from '../../core/design/cn';
import { localStoragePrefs, type DevicePrefs } from '../../core/data/devicePrefs';
import { currentServerReach, subscribeServerReach } from '../../core/data/serverStatus';
import { readLabelPrinter } from '../../core/hardware/print/labelPrinter';
import { lastPrintFailed, printerStatusVersion, subscribePrintOutcome } from '../../core/hardware/print/printerStatus';
import { useWorkRuntime } from '../../core/operations/OperationContext';
import type { StoredOperation } from '../../core/operations/operationStore';
import type { TabKey } from '../keys';
import { useCurrentBatchProgress } from './batchProgress';
import { statusBarItems, unsentCount, type StatusTone } from './statusBar';

const NO_OPERATIONS: StoredOperation[] = [];
const noSubscribe = () => () => {};
const noOperations = () => NO_OPERATIONS;

function useUnsentCount(): number {
  const runner = useWorkRuntime()?.runner;
  const operations = useSyncExternalStore(runner?.subscribe ?? noSubscribe, runner?.getSnapshot ?? noOperations);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (operations.length === 0) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [operations]);
  return unsentCount(operations, now);
}

const DOT: Record<StatusTone, string> = {
  ok: 'bg-[#1E7A46]',
  bad: 'bg-[#C62828]',
  warn: 'bg-[#D99A00]',
  idle: 'bg-[#9AA0AC]',
};

/** 상태바 28px(스펙 §5.5). */
export function StatusBar({ tab, prefs = localStoragePrefs }: { tab: TabKey | null; prefs?: DevicePrefs }) {
  // 판수가 오를 때마다 다시 그려 프린터 설정 여부(prefs)와 마지막 실패를 함께 다시 읽는다
  useSyncExternalStore(subscribePrintOutcome, printerStatusVersion);
  const printFailed = lastPrintFailed();
  const server = useSyncExternalStore(subscribeServerReach, currentServerReach);
  const unsent = useUnsentCount();
  const batch = useCurrentBatchProgress();
  const items = statusBarItems({
    printer: { configured: readLabelPrinter(prefs) !== null, lastFailed: printFailed },
    server,
    unsent,
    batch,
    tab,
  });
  return (
    <footer
      aria-label="상태"
      className="flex h-7 shrink-0 items-center gap-[18px] bg-[#E2E4E8] px-4 text-[13px] text-[#3F4450] print:hidden"
    >
      {items.map((item) =>
        item.id === 'batch' ? (
          <span key={item.id} className="ml-auto font-mono font-semibold">
            {item.label}
          </span>
        ) : item.id === 'unsent' ? (
          <span key={item.id} data-tone={item.tone} className="rounded bg-[#FFF1C7] px-2 font-semibold text-[#5E3B00]">
            {item.label}
          </span>
        ) : (
          <span key={item.id} data-tone={item.tone} className="flex items-center gap-1.5">
            <span aria-hidden className={cn('h-2 w-2 rounded-full', DOT[item.tone])} />
            {item.label}
          </span>
        )
      )}
    </footer>
  );
}
```

- [ ] **Step 5: 통과 확인(앱 + 루트 타입)**

Run: `npx vitest run src/station/status src/core/hardware/print src/core/data && npx tsc -b && (cd ../.. && npm run type-check)`
Expected: PASS, 앱 타입 에러 0, 루트 type-check 에러 0(루트 core 통합 스펙이 `httpClient.ts` → `serverStatus.ts` 를 불러온다)

- [ ] **Step 6: Commit**

```bash
git add src/core/hardware/print/printerStatus.ts src/core/hardware/print/labelPrinter.ts src/core/hardware/print/labelPrinter.test.ts src/core/data/serverStatus.ts src/core/data/httpClient.ts src/core/data/httpClient.test.ts src/station/status
git commit -m "feat(warehouse-app): 스테이션 상태바 — 프린터·서버·미전송·배치 진행"
```

---

### Task 8: 스테이션 셸 — 탭 바·하위 탭·기능키 바·상태바 (§4·§5.1)

**Files:**
- Create: `native/warehouse-app/src/station/tabs.ts`
- Create: `native/warehouse-app/src/station/Kbd.tsx`
- Create: `native/warehouse-app/src/station/FunctionKeyBar.tsx`
- Create: `native/warehouse-app/src/station/StationShell.tsx`
- Create: `native/warehouse-app/src/core/design/shellChrome.ts`
- Modify: `native/warehouse-app/src/app/routeTree.tsx` (`/outbound/batches` 추가)
- Test: `native/warehouse-app/src/station/tabs.test.ts`
- Test: `native/warehouse-app/src/station/StationShell.test.tsx`

**Interfaces:**
- Consumes: Task 3~7 전부 — `TAB_KEYS`, `parseCommand`, `ActionRegistryProvider`·`useStationActions`·`useRegistryApi`·`useResolvedActions`, `useStationKeyCapture`, `useCommandScans`, `FeedbackProvider`·`useFeedback`·`useFlash`, `ToneSink`, `BatchProgressProvider`, `StatusBar`, `functionBarItems`
- Produces:
  - `type StationPath = '/outbound' | '/outbound/batches' | '/inbound' | '/putaway' | '/returns/putaway' | '/movement' | '/stocktaking' | '/inventory'`
  - `STATION_TABS: readonly StationTab[]`, `activeTabOf(pathname): StationTab | null`, `activeSectionOf(tab, pathname): StationSection | null`
  - `StationShell({ sink?: ToneSink | null })` — `<Outlet/>` 을 품는 라우트 레이아웃
  - `ShellChromeContext`(`{ hidesHomeBack: boolean }`, 기본 false) — Task 9 의 `ScreenHeader` 가 읽는다

- [ ] **Step 1: 탭 판정 테스트**

`src/station/tabs.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { STATION_TABS, activeSectionOf, activeTabOf } from './tabs';

describe('activeTabOf — 가장 긴 접두어가 이긴다', () => {
  it.each([
    ['/outbound', 'F1'],
    ['/outbound/simple/s-1', 'F1'],
    ['/outbound/withdraw/s-1', 'F1'],
    ['/outbound/batches', 'F2'],
    ['/inbound', 'F3'],
    ['/inbound/purchase-orders/po-1', 'F3'],
    ['/inbound/quick', 'F3'],
    ['/inbound/history', 'F3'],
    ['/putaway', 'F4'],
    ['/returns/putaway', 'F4'],
    ['/movement', 'F4'],
    ['/stocktaking/s-1/variances', 'F5'],
    ['/inventory', 'F6'],
    ['/inventory/sku-1/adjust', 'F6'],
  ])('%s → %s', (path, key) => {
    expect(activeTabOf(path)?.key).toBe(key);
  });

  it.each(['/', '/settings', '/diagnostics', '/station/command-sheet', '/outboundx'])('%s 는 어느 탭도 아니다', (path) => {
    expect(activeTabOf(path)).toBeNull();
  });
});

describe('activeSectionOf', () => {
  const f4 = STATION_TABS.find((t) => t.key === 'F4');
  it.each([
    ['/putaway', '적치'],
    ['/returns/putaway', '되돌림 적치'],
    ['/movement', '이동'],
  ])('%s → %s', (path, label) => {
    expect(f4 && activeSectionOf(f4, path)?.label).toBe(label);
  });
});

describe('STATION_TABS', () => {
  it('F1~F6 순서, 각 탭의 첫 경로는 자기 탭에 속한다', () => {
    expect(STATION_TABS.map((t) => t.key)).toEqual(['F1', 'F2', 'F3', 'F4', 'F5', 'F6']);
    for (const tab of STATION_TABS) expect(activeTabOf(tab.to)?.key).toBe(tab.key);
  });

  it('하위 탭은 F4 에만 — F3 은 입고 화면이 간편입고·입고내역 링크를 이미 갖는다(U2)', () => {
    expect(STATION_TABS.filter((t) => t.sections.length > 0).map((t) => t.key)).toEqual(['F4']);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/station/tabs.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 탭 표 구현**

`src/station/tabs.ts`:

```ts
import type { TabKey } from './keys';

/** 탭이 그리는 경로. 리터럴 유니온이라 앱 라우트에 없는 경로를 적으면 <Link> 에서 타입 에러가 난다. */
export type StationPath =
  | '/outbound'
  | '/outbound/batches'
  | '/inbound'
  | '/putaway'
  | '/returns/putaway'
  | '/movement'
  | '/stocktaking'
  | '/inventory';

export interface StationSection {
  label: string;
  to: StationPath;
}

export interface StationTab {
  key: TabKey;
  label: string;
  to: StationPath;
  /** 이 탭에 속하는 경로 접두어 */
  owns: readonly string[];
  /** 탭 안 화면끼리 오갈 길이 화면에 없을 때만 둔다(U2 — 같은 길을 두 곳에 두지 않는다) */
  sections: readonly StationSection[];
}

/**
 * 스테이션 탭(스펙 §4). 새 탭 화면이 생기기 전(PR C~G)에는 지금 화면을 그 탭 안에 그대로 그린다.
 * - F2 는 PR C 전까지 출고 화면(배치 카드가 거기 있다)을 같이 그린다
 * - F3 은 입고 화면이 간편입고·입고내역 링크를 이미 가져 하위 탭이 없다
 * - F4 는 적치 화면에서 이동·되돌림 적치로 갈 길이 없어 하위 탭을 둔다
 */
export const STATION_TABS: readonly StationTab[] = [
  { key: 'F1', label: '출고 검수', to: '/outbound', owns: ['/outbound'], sections: [] },
  { key: 'F2', label: '배치 현황', to: '/outbound/batches', owns: ['/outbound/batches'], sections: [] },
  { key: 'F3', label: '입고', to: '/inbound', owns: ['/inbound'], sections: [] },
  {
    key: 'F4',
    label: '적치·이동',
    to: '/putaway',
    owns: ['/putaway', '/returns/putaway', '/movement'],
    sections: [
      { label: '적치', to: '/putaway' },
      { label: '되돌림 적치', to: '/returns/putaway' },
      { label: '이동', to: '/movement' },
    ],
  },
  { key: 'F5', label: '실사', to: '/stocktaking', owns: ['/stocktaking'], sections: [] },
  { key: 'F6', label: '재고 조회', to: '/inventory', owns: ['/inventory'], sections: [] },
];

const within = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

/** 경로가 속한 탭 — 가장 긴 접두어가 이긴다(`/outbound/batches` 는 F2, `/outbound/simple/…` 는 F1). 설정·진단은 null. */
export function activeTabOf(pathname: string): StationTab | null {
  let best: { tab: StationTab; length: number } | null = null;
  for (const tab of STATION_TABS)
    for (const prefix of tab.owns)
      if (within(pathname, prefix) && (best === null || prefix.length > best.length)) best = { tab, length: prefix.length };
  return best?.tab ?? null;
}

export function activeSectionOf(tab: StationTab, pathname: string): StationSection | null {
  let best: StationSection | null = null;
  for (const section of tab.sections)
    if (within(pathname, section.to) && (best === null || section.to.length > best.to.length)) best = section;
  return best;
}
```

- [ ] **Step 4: 탭 판정 통과 확인**

Run: `npx vitest run src/station/tabs.test.ts`
Expected: PASS

- [ ] **Step 5: 셸 테스트**

`src/station/StationShell.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { WarehouseProvider } from '../app/warehouse-context';
import { createMemoryPrefs } from '../core/data/devicePrefs';
import { ScanProvider } from '../core/hardware/scan/ScanProvider';
import { useStationActions } from './ActionRegistry';
import type { StationAction } from './actions';
import type { Beep, ToneSink } from './feedback/soundPlayer';
import { useBatchProgress } from './status/batchProgress';
import { StationShell } from './StationShell';

vi.mock('@tauri-apps/plugin-os', () => ({ platform: () => 'windows' }));

const qtyRun = vi.fn();
const PROBE_ACTIONS: StationAction[] = [
  { id: 'probe-qty', key: 'F7', label: '수량', enabled: true, run: () => qtyRun() },
  { id: 'probe-all', key: 'F8', label: '이 상품 전량', enabled: false, run: () => {} },
];

function Probe() {
  useStationActions(PROBE_ACTIONS);
  useBatchProgress({ code: 'B-1002', done: 13, total: 40 });
  return <input aria-label="운송장번호" />;
}

function scan(code: string) {
  act(() => {
    for (const key of [...code, 'Enter']) window.dispatchEvent(new KeyboardEvent('keydown', { key }));
  });
}

function renderShell(initial = '/outbound') {
  const beeps: Beep[] = [];
  const sink: ToneSink = { now: () => 0, beep: (b) => void beeps.push(b) };
  const root = createRootRoute({ component: () => <StationShell sink={sink} /> });
  const page = (path: string) =>
    createRoute({ getParentRoute: () => root, path, component: () => <p>{`page ${path}`}</p> });
  const tree = root.addChildren([
    createRoute({ getParentRoute: () => root, path: '/outbound', component: Probe }),
    page('/outbound/batches'),
    page('/inbound'),
    page('/putaway'),
    page('/returns/putaway'),
    page('/movement'),
    page('/stocktaking'),
    page('/inventory'),
    page('/settings'),
  ]);
  const router = createRouter({ routeTree: tree, history: createMemoryHistory({ initialEntries: [initial] }) });
  render(
    <ScanProvider>
      <WarehouseProvider prefs={createMemoryPrefs({ 'almondwms.warehouse': JSON.stringify({ id: 'w-1', name: '부천 창고' }) })}>
        {/* 테스트 전용 라우터라 앱의 Register 타입과 다르다 */}
        <RouterProvider router={router as never} />
      </WarehouseProvider>
    </ScanProvider>
  );
  return { router, beeps };
}

const flash = () => document.querySelector('[data-flash]')?.getAttribute('data-flash') ?? null;

describe('StationShell', () => {
  beforeEach(() => qtyRun.mockReset());

  it('탭 6개를 키와 함께 그리고 지금 탭을 표시한다', async () => {
    renderShell();
    const tabs = await screen.findByRole('navigation', { name: '탭' });
    expect(within(tabs).getAllByRole('link')).toHaveLength(6);
    expect(within(tabs).getByRole('link', { name: /출고 검수/ })).toHaveAttribute('data-active', 'true');
    expect(within(tabs).getByRole('link', { name: /재고 조회/ })).toHaveAttribute('data-active', 'false');
  });

  it('입력칸에 포커스가 있어도 F3 이 입고 탭으로 간다', async () => {
    const { router } = renderShell();
    const input = await screen.findByLabelText('운송장번호');
    input.focus();
    expect(fireEvent.keyDown(input, { key: 'F3' })).toBe(false);
    await waitFor(() => expect(router.state.location.pathname).toBe('/inbound'));
  });

  it('화면 액션: 켜진 것만 기능키 바에(탭 키는 다시 그리지 않는다), F7 은 실행, 꺼진 F8 은 오류', async () => {
    const { beeps } = renderShell();
    const bar = await screen.findByRole('toolbar', { name: '기능키' });
    expect(await within(bar).findByRole('button', { name: /수량/ })).toBeInTheDocument();
    expect(within(bar).queryByRole('button', { name: /이 상품 전량/ })).toBeNull();
    expect(within(bar).queryByRole('button', { name: /출고 검수/ })).toBeNull();
    fireEvent.keyDown(window, { key: 'F7' });
    expect(qtyRun).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: 'F8' });
    expect(flash()).toBe('error');
    expect(beeps.some((b) => b.wave === 'square')).toBe(true);
  });

  it('기능키 바 버튼을 마우스로 눌러도 같은 액션이 돈다', async () => {
    renderShell();
    fireEvent.click(await screen.findByRole('button', { name: /수량/ }));
    expect(qtyRun).toHaveBeenCalledTimes(1);
  });

  it('명령 바코드: %90%07 은 F7 과 같고(명령음), 모르는 명령은 오류, 다음 스캔에서 테두리가 사라진다', async () => {
    const { beeps } = renderShell();
    await screen.findByRole('button', { name: /수량/ });
    scan('%90%07');
    expect(qtyRun).toHaveBeenCalledTimes(1);
    expect(beeps.at(-1)?.frequency).toBe(2637);
    scan('%99%99');
    expect(flash()).toBe('error');
    scan('8801234567890');
    expect(flash()).toBeNull();
  });

  it('명령 바코드 %90%03 은 입고 탭으로 — 출고 화면의 송장 조회로 새지 않는다', async () => {
    const { router } = renderShell();
    await screen.findByLabelText('운송장번호');
    scan('%90%03');
    await waitFor(() => expect(router.state.location.pathname).toBe('/inbound'));
  });

  it('F4 탭은 하위 탭으로 적치·되돌림 적치·이동을 오간다, F1 에는 하위 탭이 없다', async () => {
    const { router } = renderShell('/movement');
    const sub = await screen.findByRole('navigation', { name: '하위 탭' });
    expect(within(sub).getByRole('link', { name: '이동' })).toHaveAttribute('data-active', 'true');
    fireEvent.click(within(sub).getByRole('link', { name: '되돌림 적치' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/returns/putaway'));
    expect(screen.getByRole('link', { name: /적치·이동/ })).toHaveAttribute('data-active', 'true');
    fireEvent.keyDown(window, { key: 'F1' });
    await waitFor(() => expect(router.state.location.pathname).toBe('/outbound'));
    expect(screen.queryByRole('navigation', { name: '하위 탭' })).toBeNull();
  });

  it('상태바의 배치 진행은 F1 화면이 올리고, 다른 탭으로 가면 사라진다', async () => {
    const { router } = renderShell();
    expect(await screen.findByText('B-1002 13/40')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'F3' });
    await waitFor(() => expect(router.state.location.pathname).toBe('/inbound'));
    expect(screen.queryByText('B-1002 13/40')).toBeNull();
  });

  it('창고 이름이 설정으로 가는 링크다', async () => {
    renderShell();
    expect(await screen.findByRole('link', { name: '부천 창고' })).toHaveAttribute('href', '/settings');
  });
});
```

- [ ] **Step 6: 실패 확인**

Run: `npx vitest run src/station/StationShell.test.tsx`
Expected: FAIL — `./StationShell` 없음

- [ ] **Step 7: 셸 구현**

`src/core/design/shellChrome.ts`:

```ts
import { createContext } from 'react';

/** 화면을 감싼 셸이 무엇을 대신 그리는지. 스테이션 셸은 탭 바가 홈을 대신하므로 «홈으로 뒤로» 를 감춘다. */
export const ShellChromeContext = createContext({ hidesHomeBack: false });
```

`src/station/Kbd.tsx`:

```tsx
import type { ReactNode } from 'react';
import { cn } from '../core/design/cn';

export function Kbd({ children, tone = 'dark' }: { children: ReactNode; tone?: 'dark' | 'muted' | 'light' }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 min-w-[30px] items-center justify-center rounded px-1.5 font-mono text-xs font-semibold',
        tone === 'dark' && 'bg-[#15171C] text-white',
        tone === 'muted' && 'bg-[#2A303C] text-[#C3C8D2]',
        tone === 'light' && 'bg-[#E2E4E8] text-[#15171C]'
      )}
    >
      {children}
    </span>
  );
}
```

`src/station/FunctionKeyBar.tsx`:

```tsx
import { cn } from '../core/design/cn';
import { useRegistryApi, useResolvedActions } from './ActionRegistry';
import { functionBarItems } from './actions';
import { Kbd } from './Kbd';
import type { StationKey } from './keys';

/** 기능키 바 56px(스펙 §5.1). 마우스로 눌러도 같은 액션이 돈다 — 실행은 늘 최신 등록에서 꺼낸다. */
export function FunctionKeyBar({ omit }: { omit: ReadonlySet<StationKey> }) {
  const resolved = useResolvedActions();
  const api = useRegistryApi();
  return (
    <div
      role="toolbar"
      aria-label="기능키"
      className="flex h-14 shrink-0 items-center gap-2 border-t border-[#D5D8DE] bg-white px-3 print:hidden"
    >
      {functionBarItems(resolved, omit).map((action) => (
        <button
          key={action.id}
          type="button"
          onClick={() => {
            const dispatch = api?.resolveKey(action.key);
            if (dispatch?.kind === 'run') dispatch.action.run();
          }}
          className={cn(
            'flex h-10 items-center gap-2 rounded-md border border-[#D5D8DE] bg-white pl-2 pr-3.5 text-sm font-medium text-[#15171C]',
            action.key === 'Escape' && 'ml-auto'
          )}
        >
          <Kbd tone={action.key === 'Escape' ? 'light' : 'dark'}>{action.key === 'Escape' ? 'Esc' : action.key}</Kbd>
          {action.label}
        </button>
      ))}
    </div>
  );
}
```

`src/station/StationShell.tsx`:

```tsx
import { useCallback, useMemo } from 'react';
import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { Wrench } from 'lucide-react';
import { useWarehouse } from '../app/warehouse-context';
import { cn } from '../core/design/cn';
import { ShellChromeContext } from '../core/design/shellChrome';
import { useDeveloperMode } from '../core/diagnostics/DeveloperModeProvider';
import { useCommandScans } from '../core/hardware/scan/useScanner';
import { ActionRegistryProvider, useRegistryApi, useStationActions } from './ActionRegistry';
import type { StationAction } from './actions';
import { parseCommand } from './commandCode';
import { FeedbackProvider, useFeedback, useFlash } from './feedback/FeedbackProvider';
import type { ToneSink } from './feedback/soundPlayer';
import { FunctionKeyBar } from './FunctionKeyBar';
import { Kbd } from './Kbd';
import { TAB_KEYS, type StationKey } from './keys';
import { BatchProgressProvider } from './status/batchProgress';
import { StatusBar } from './status/StatusBar';
import { STATION_TABS, activeSectionOf, activeTabOf } from './tabs';
import { useStationKeyCapture } from './useStationKeys';

const TAB_KEY_SET: ReadonlySet<StationKey> = new Set<StationKey>(TAB_KEYS);
const STATION_CHROME = { hidesHomeBack: true };

/**
 * 스테이션 셸(스펙 §5) — 탭 바 52px · (하위 탭) · 작업 영역 · 기능키 바 56px · 상태바 28px.
 * 라우트 레이아웃이다: 작업 화면은 <Outlet/> 으로 그 안에 그려진다.
 */
export function StationShell({ sink }: { sink?: ToneSink | null }) {
  return (
    <ActionRegistryProvider>
      <FeedbackProvider sink={sink}>
        <BatchProgressProvider>
          <ShellChromeContext.Provider value={STATION_CHROME}>
            <ShellFrame />
          </ShellChromeContext.Provider>
        </BatchProgressProvider>
      </FeedbackProvider>
    </ActionRegistryProvider>
  );
}

function ShellFrame() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const tab = activeTabOf(pathname);
  const section = tab ? activeSectionOf(tab, pathname) : null;
  const navigate = useNavigate();
  const { warehouseName } = useWarehouse();
  const developer = useDeveloperMode();
  const { signal } = useFeedback();
  const flash = useFlash();
  const registry = useRegistryApi();

  // 탭 전환(F1~F6)은 셸 자신의 액션이다(스펙 §5.2).
  const tabActions = useMemo<StationAction[]>(
    () =>
      STATION_TABS.map((t) => ({
        id: `tab-${t.key}`,
        key: t.key,
        label: t.label,
        enabled: true,
        run: () => void navigate({ to: t.to }),
      })),
    [navigate]
  );
  useStationActions(tabActions);

  const reject = useCallback(() => signal('error'), [signal]);
  useStationKeyCapture(reject);

  useCommandScans(
    useCallback(
      (code: string) => {
        const command = parseCommand(code);
        if (command.kind === 'key') {
          const dispatch = registry?.resolveKey(command.key);
          if (dispatch?.kind === 'run') {
            signal('command');
            dispatch.action.run();
            return;
          }
        } else if (command.kind === 'digit') {
          const handler = registry?.digitHandler();
          if (handler) {
            signal('command');
            handler(command.digit);
            return;
          }
        }
        // 모르는 명령·지금 꺼진 명령(스펙 §5.3)
        signal('error');
      },
      [registry, signal]
    )
  );

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#EDEEF0] text-[#15171C] print:h-auto print:overflow-visible print:bg-white">
      <header className="flex h-[52px] shrink-0 items-stretch gap-0.5 bg-[#161A22] pl-5 pr-4 text-[#E6E8EC] print:hidden">
        <div className="flex items-center pr-5 text-[15px] font-bold">
          {import.meta.env.VITE_APP_STAGE === 'demo' ? 'LCNINE 물류 · DEMO' : 'LCNINE 물류'}
        </div>
        <nav aria-label="탭" className="flex items-end gap-0.5">
          {STATION_TABS.map((t) => {
            const active = tab?.key === t.key;
            return (
              <Link
                key={t.key}
                to={t.to}
                data-active={String(active)}
                className={cn(
                  'flex h-11 items-center gap-2 pl-2.5 pr-4 text-sm',
                  active
                    ? 'rounded-t-lg bg-[#EDEEF0] font-semibold text-[#15171C]'
                    : 'font-medium text-[#C3C8D2] hover:text-white'
                )}
              >
                <Kbd tone={active ? 'dark' : 'muted'}>{t.key}</Kbd>
                {t.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-4 text-[13px] text-[#A9AFBB]">
          {developer.enabled && (
            <Link to="/diagnostics" aria-label="개발자 진단" className="hover:text-white">
              <Wrench className="h-4 w-4" aria-hidden />
            </Link>
          )}
          <Link to="/settings" className="hover:text-white">
            {warehouseName ?? '창고 미설정'}
          </Link>
        </div>
      </header>
      {tab !== null && tab.sections.length > 0 && (
        <nav
          aria-label="하위 탭"
          className="flex h-10 shrink-0 items-center gap-1 border-b border-[#D5D8DE] bg-white px-3 print:hidden"
        >
          {tab.sections.map((s) => {
            const active = section?.to === s.to;
            return (
              <Link
                key={s.to}
                to={s.to}
                data-active={String(active)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm',
                  active ? 'bg-[#15171C] font-semibold text-white' : 'text-[#3F4450] hover:bg-[#EDEEF0]'
                )}
              >
                {s.label}
              </Link>
            );
          })}
        </nav>
      )}
      <main className="min-h-0 flex-1 overflow-y-auto p-3 print:overflow-visible print:p-0">
        <Outlet />
      </main>
      <FunctionKeyBar omit={TAB_KEY_SET} />
      <StatusBar tab={tab?.key ?? null} />
      {flash !== null && (
        <div
          aria-hidden
          data-flash={flash}
          className={cn(
            'pointer-events-none fixed inset-0 z-[90] border-[6px] print:hidden',
            flash === 'error' ? 'border-[#C62828]' : 'border-[#1E7A46]'
          )}
        />
      )}
    </div>
  );
}
```

`routeTree.tsx` — `outboundRoute` 정의 바로 아래에:

```tsx
// 스테이션 F2 배치 현황 — PR C 가 배치 현황 화면으로 바꾸기 전까지 출고 화면(배치 카드 포함)을 그대로 그린다(스펙 §4).
const outboundBatchesRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/outbound/batches',
  component: OutboundRoute,
});
```

`routeTree` 의 `authedRoute.addChildren([...])` 에서 `outboundRoute,` 다음 줄에 `outboundBatchesRoute,` 를 더한다.

- [ ] **Step 8: 통과 확인**

Run: `npx vitest run src/station && npx tsc -b`
Expected: PASS, 타입 에러 0. (`<Link to={t.to}>` 가 타입 에러면 `StationPath` 의 경로가 routeTree 에 없다는 뜻 — `/outbound/batches` 를 더했는지 본다)

- [ ] **Step 9: Commit**

```bash
git add src/station/tabs.ts src/station/tabs.test.ts src/station/Kbd.tsx src/station/FunctionKeyBar.tsx src/station/StationShell.tsx src/station/StationShell.test.tsx src/core/design/shellChrome.ts src/app/routeTree.tsx
git commit -m "feat(warehouse-app): 스테이션 셸 — 탭 바·하위 탭·기능키 바·상태바·명령 바코드"
```

---

### Task 9: 앱에 연결 — 스테이션만 셸, 핸드헬드는 그대로 (§4)

**Files:**
- Modify: `native/warehouse-app/src/app/routes/AuthedLayout.tsx`
- Modify: `native/warehouse-app/src/app/routes/RootLayout.tsx`
- Modify: `native/warehouse-app/src/app/routes/ProfileHome.tsx`
- Delete: `native/warehouse-app/src/profiles/station/StationHome.tsx`
- Modify: `native/warehouse-app/src/core/design/ScreenHeader.tsx`
- Modify: `native/warehouse-app/src-tauri/tauri.conf.json`, `native/warehouse-app/src-tauri/tauri.demo.conf.json`
- Test: `native/warehouse-app/src/app/router.test.tsx` (스테이션 기대값 교체)
- Test: `native/warehouse-app/src/app/router.handheld.test.tsx` (추가)
- Test: `native/warehouse-app/src/core/design/ScreenHeader.test.tsx` (추가)

**Interfaces:**
- Consumes: `StationShell` (Task 8), `ShellChromeContext` (Task 8), `isStationDevice` (`app/station.ts`)
- Produces: 스테이션 로그인 뒤 첫 경로 = `/outbound`. 스테이션 화면에서 `ScreenHeader backTo="/"` 의 뒤로 링크는 그려지지 않는다

- [ ] **Step 1: 실패하는 테스트**

`ScreenHeader.test.tsx` — import 에 `import { ShellChromeContext } from './shellChrome';` 를 더하고 `describe` 안에 추가:

```tsx
  it('스테이션 셸 안에서는 홈(/)으로 가는 뒤로를 감춘다 — 탭 바가 홈이다', async () => {
    renderAt(
      <ShellChromeContext.Provider value={{ hidesHomeBack: true }}>
        <ScreenHeader title="실사" backTo="/" />
        <ScreenHeader title="입고내역" backTo="/inbound" />
      </ShellChromeContext.Provider>
    );
    expect(await screen.findByRole('heading', { name: '실사' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: '뒤로' })).toHaveLength(1);
    expect(screen.getByRole('link', { name: '뒤로' })).toHaveAttribute('href', '/inbound');
  });
```

`router.test.tsx` 를 통째로 다음으로 바꾼다(스테이션은 이제 홈 타일 대신 셸이 뜨고, 첫 화면이 출고라 쿼리·API 프로바이더가 필요하다):

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act, waitFor, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createRouter, createMemoryHistory } from '@tanstack/react-router';
import { SessionProvider } from './session-context';
import { WarehouseProvider } from './warehouse-context';
import { createMemoryPrefs } from '../core/data/devicePrefs';
import { ApiClientProvider } from '../core/data/ApiClientProvider';
import type { ApiClient } from '../core/data/httpClient';
import { ScanProvider } from '../core/hardware/scan/ScanProvider';
import { routeTree } from './routeTree';
import type { Session } from '../core/auth/session';

vi.mock('@tauri-apps/plugin-os', () => ({ platform: () => 'windows' }));

function makeStub() {
  let authed = false;
  const ls = new Set<() => void>();
  const session: Session = {
    bootstrap: async () => {},
    isAuthenticated: () => authed,
    getAccessToken: async () => 'tok',
    login: async () => {
      authed = true;
      ls.forEach((l) => l());
    },
    logout: async () => {
      authed = false;
      ls.forEach((l) => l());
    },
    subscribe: (fn: () => void) => {
      ls.add(fn);
      return () => {
        ls.delete(fn);
      };
    },
  } satisfies Session;
  return {
    session,
    setAuthed: (v: boolean) => {
      authed = v;
      ls.forEach((l) => l());
    },
  };
}

// 창고 미설정으로 렌더한다 — 각 화면은 창고 목록(빈 배열)만 부르고 창고 선택을 요구한다.
const client: ApiClient = {
  request: (async (opts: { path: string }) =>
    opts.path === '/inventory/warehouses' ? [] : { data: [], total: 0 }) as unknown as ApiClient['request'],
};

function renderAppRouter(initialEntries: string[], session: Session) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries }),
    context: { session },
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <SessionProvider session={session}>
      <QueryClientProvider client={qc}>
        <ApiClientProvider client={client}>
          <WarehouseProvider prefs={createMemoryPrefs()}>
            <ScanProvider>
              <RouterProvider router={router} />
            </ScanProvider>
          </WarehouseProvider>
        </ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
  return router;
}

const renderApp = (session: Session) => renderAppRouter(['/'], session);

describe('router guard integration (스테이션)', () => {
  it('sends an unauthenticated user to the login screen', async () => {
    const { session } = makeStub();
    renderApp(session);
    expect(await screen.findByRole('button', { name: /^login$/i })).toBeInTheDocument();
  });

  it('로그인 뒤 셸이 창 전체를 쓰고 첫 탭은 출고 검수다', async () => {
    const { session, setAuthed } = makeStub();
    setAuthed(true);
    const router = renderApp(session);
    expect(await screen.findByRole('navigation', { name: '탭' })).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.pathname).toBe('/outbound'));
    expect(screen.queryByText('Almond WMS')).toBeNull();
  });

  it('redirects to login when the session logs out', async () => {
    const { session, setAuthed } = makeStub();
    setAuthed(true);
    renderApp(session);
    expect(await screen.findByRole('navigation', { name: '탭' })).toBeInTheDocument();
    await act(async () => {
      setAuthed(false);
    });
    expect(await screen.findByRole('button', { name: /^login$/i })).toBeInTheDocument();
  });

  it('keeps diagnostics off the ordinary work shell', async () => {
    const { session, setAuthed } = makeStub();
    setAuthed(true);
    renderApp(session);
    expect(await screen.findByRole('navigation', { name: '탭' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /진단/ })).not.toBeInTheDocument();
  });

  it('/picking 과 /packing 은 /outbound 로 보낸다', async () => {
    const { session, setAuthed } = makeStub();
    setAuthed(true);
    const router = renderAppRouter(['/picking'], session);
    await waitFor(() => expect(router.state.location.pathname).toBe('/outbound'));
  });

  it('F5 는 웹뷰 새로고침 대신 실사 탭이다', async () => {
    const { session, setAuthed } = makeStub();
    setAuthed(true);
    const router = renderApp(session);
    await screen.findByRole('navigation', { name: '탭' });
    expect(fireEvent.keyDown(window, { key: 'F5' })).toBe(false);
    await waitFor(() => expect(router.state.location.pathname).toBe('/stocktaking'));
  });
});

it('예전 스테이션 홈 타일의 작업에 탭·하위 탭으로 모두 닿는다(U3)', async () => {
  const { session, setAuthed } = makeStub();
  setAuthed(true);
  const router = renderApp(session);
  await screen.findByRole('navigation', { name: '탭' });
  // 입고내역·간편입고는 입고 화면 안의 링크로 간다 — ExpectedArrivalListScreen 테스트가 그 링크를 지킨다
  const cases: Array<[string, string | null, string]> = [
    ['F6', null, '/inventory'],
    ['F3', null, '/inbound'],
    ['F4', '적치', '/putaway'],
    ['F4', '되돌림 적치', '/returns/putaway'],
    ['F4', '이동', '/movement'],
    ['F5', null, '/stocktaking'],
    ['F1', null, '/outbound'],
    ['F2', null, '/outbound/batches'],
  ];
  for (const [key, section, path] of cases) {
    fireEvent.keyDown(window, { key });
    if (section) {
      const sub = await screen.findByRole('navigation', { name: '하위 탭' });
      fireEvent.click(within(sub).getByRole('link', { name: section }));
    }
    await waitFor(() => expect(router.state.location.pathname).toBe(path));
  }
  fireEvent.click(screen.getByRole('link', { name: '창고 미설정' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/settings'));
});
```

`router.handheld.test.tsx` 의 `describe` 끝에 추가(`fireEvent` 를 import 에 더한다):

```tsx
  it('핸드헬드는 셸이 없고 기능키를 가로채지 않는다 — 홈 타일·제목 줄 그대로', async () => {
    const session = stub();
    const client: ApiClient = {
      request: (async (opts: { path: string }) => {
        if (opts.path === '/inventory/warehouses') return [];
        return { data: [], total: 0 };
      }) as unknown as ApiClient['request'],
    };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <SessionProvider session={session}>
        <QueryClientProvider client={qc}>
          <ApiClientProvider client={client}>
            <WarehouseProvider prefs={createMemoryPrefs()}>
              <ScanProvider>
                <RouterProvider router={createAppRouter(session)} />
              </ScanProvider>
            </WarehouseProvider>
          </ApiClientProvider>
        </QueryClientProvider>
      </SessionProvider>
    );
    expect(await screen.findByRole('link', { name: /재고조회/ })).toBeInTheDocument();
    expect(screen.getByText('Almond WMS')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: '탭' })).toBeNull();
    expect(fireEvent.keyDown(window, { key: 'F5' })).toBe(true);
  });
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/app src/core/design/ScreenHeader.test.tsx`
Expected: FAIL — 스테이션 라우터 테스트(탭 내비게이션 없음), ScreenHeader(뒤로 2개). 핸드헬드 테스트는 이미 PASS 일 수 있다(그게 정상 — 바뀌면 안 되는 것을 고정하는 테스트다)

- [ ] **Step 3: 구현**

`AuthedLayout.tsx`:

```tsx
import { useEffect } from 'react';
import { Outlet, useNavigate, Link } from '@tanstack/react-router';
import { Warehouse as WarehouseIcon } from 'lucide-react';
import { useIsAuthenticated } from '../session-context';
import { useWarehouse } from '../warehouse-context';
import { isStationDevice } from '../station';
import { StationShell } from '../../station/StationShell';

export function AuthedLayout() {
  const authed = useIsAuthenticated();
  const navigate = useNavigate();
  const { warehouseName } = useWarehouse();
  // beforeLoad gates entry; this effect handles a live logout / refresh
  // failure while an authenticated screen is already mounted.
  useEffect(() => {
    if (!authed) navigate({ to: '/login' });
  }, [authed, navigate]);
  // 셸 선택은 여기 한 곳(스펙 §4). 스테이션은 탭 셸 안에 화면을 그리고, 핸드헬드는 지금 그대로다.
  if (isStationDevice()) return <StationShell />;
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Link
          to="/settings"
          className="flex items-center gap-1.5 rounded-full border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 active:bg-gray-100"
        >
          <WarehouseIcon className="h-3.5 w-3.5 text-blue-600" aria-hidden />
          {warehouseName ?? '창고 미설정'}
        </Link>
      </div>
      <Outlet />
    </div>
  );
}
```

`RootLayout.tsx`:

```tsx
import { Outlet } from '@tanstack/react-router';
import { App } from '../App';
import { useIsAuthenticated } from '../session-context';
import { isStationDevice } from '../station';

export function RootLayout() {
  const authed = useIsAuthenticated();
  // 로그인한 스테이션은 셸이 창 전체를 쓴다 — 탭 바가 제목 줄을 대신한다(스펙 §5.1). 로그인 화면·핸드헬드는 그대로.
  if (authed && isStationDevice()) return <Outlet />;
  return (
    <App>
      <Outlet />
    </App>
  );
}
```

`ProfileHome.tsx`:

```tsx
import { Navigate } from '@tanstack/react-router';
import { isStationDevice } from '../station';
import { HandheldHome } from '../../profiles/handheld/HandheldHome';

/** 스테이션엔 홈이 없다 — 탭 바가 홈이고 첫 화면은 F1 출고 검수다. */
export function ProfileHome() {
  return isStationDevice() ? <Navigate to="/outbound" replace /> : <HandheldHome />;
}
```

```bash
git rm src/profiles/station/StationHome.tsx
```

`ScreenHeader.tsx`:

```tsx
import { useContext, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { ChevronLeft } from 'lucide-react';
import { ShellChromeContext } from './shellChrome';

/** 워크플로우 화면 공통 헤더 — 뒤로 + 제목 + 우측 슬롯(진행률·창고 등). */
export function ScreenHeader({
  title,
  backTo,
  right,
}: {
  title: string;
  backTo: string;
  right?: ReactNode;
}) {
  const { hidesHomeBack } = useContext(ShellChromeContext);
  // 스테이션 셸에는 홈이 없다(탭 바가 홈) — 홈으로 가는 뒤로는 첫 탭으로 튀기만 한다.
  const showBack = !(hidesHomeBack && backTo === '/');
  return (
    <div className="flex items-center gap-2">
      {showBack && (
        <Link
          to={backTo}
          aria-label="뒤로"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-gray-300 bg-white active:bg-gray-100"
        >
          <ChevronLeft className="h-5 w-5 text-gray-700" aria-hidden />
        </Link>
      )}
      <h1 className="flex-1 truncate text-lg font-semibold text-gray-800">{title}</h1>
      {right ? <div className="shrink-0 text-sm text-gray-600">{right}</div> : null}
    </div>
  );
}
```

`src-tauri/tauri.conf.json` 의 `app.windows[0]`:

```json
      {
        "title": "LCNINE Logistics",
        "width": 1280,
        "height": 800,
        "resizable": true,
        "fullscreen": false,
        "maximized": true
      }
```

`src-tauri/tauri.demo.conf.json` 의 `app.windows[0]`(데모 설정은 창 배열을 통째로 덮으므로 같이 바꾼다):

```json
      {
        "label": "main",
        "title": "LCNINE Logistics DEMO",
        "width": 1280,
        "height": 800,
        "resizable": true,
        "maximized": true
      }
```

- [ ] **Step 4: 통과 확인 + 전체**

Run: `grep -rn "StationHome\|station-home" src; npx vitest run && npx tsc -b`
Expected: grep 출력 없음, vitest 실패 0, 타입 에러 0. 다른 테스트가 `ScreenHeader` 의 뒤로 링크 개수나 스테이션 홈 타일을 기대해 실패하면, 그 테스트가 **스테이션 프로필(`platform: 'windows'`)로 셸 밖에서** 렌더하는지 본다 — 셸 밖이면 `hidesHomeBack` 이 false 라 바뀐 게 없어야 정상이다

- [ ] **Step 5: Commit**

```bash
git add src/app/routes/AuthedLayout.tsx src/app/routes/RootLayout.tsx src/app/routes/ProfileHome.tsx src/core/design/ScreenHeader.tsx src/core/design/ScreenHeader.test.tsx src/app/router.test.tsx src/app/router.handheld.test.tsx src-tauri/tauri.conf.json src-tauri/tauri.demo.conf.json
git commit -m "feat(warehouse-app): 스테이션은 탭 셸 안에 기존 화면을 그린다 — 핸드헬드는 그대로"
```

---

### Task 10: 명령 바코드 시트 — A4, OS 인쇄 대화상자 (§5.3)

**Files:**
- Create: `native/warehouse-app/src/station/commandSheet.ts`
- Create: `native/warehouse-app/src/station/Barcode.tsx`
- Create: `native/warehouse-app/src/station/CommandSheetScreen.tsx`
- Modify: `native/warehouse-app/src/app/routeTree.tsx` (`/station/command-sheet`)
- Modify: `native/warehouse-app/src/app/routes/SettingsRoute.tsx` (스테이션: 시트 링크)
- Modify: `native/warehouse-app/src/index.css` (`@page`)
- Test: `native/warehouse-app/src/station/commandSheet.test.ts`
- Test: `native/warehouse-app/src/station/CommandSheetScreen.test.tsx`

**Interfaces:**
- Consumes: `encodeCode128B` (Task 2), `commandCodeOfKey`·`commandCodeOfDigit`·`parseCommand` (Task 3), `ActionSpec`·`assertUniqueKeys` (Task 4), `STATION_TABS` (Task 8)
- Produces:
  - `COMMAND_SHEET_SECTIONS: readonly CommandSheetSection[]` — **PR C 이후 탭 화면은 자기 액션 절을 여기 더한다**
  - `interface CommandSheetSection { title: string; actions: readonly Pick<ActionSpec, 'key' | 'label'>[] }`
  - `keyEntry(action): SheetEntry`, `digitEntry(digit): SheetEntry`, `SHEET_DIGITS`
  - 경로 `/station/command-sheet`

- [ ] **Step 1: 실패하는 테스트**

`src/station/commandSheet.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { assertUniqueKeys } from './actions';
import { parseCommand } from './commandCode';
import { COMMAND_SHEET_SECTIONS, SHEET_DIGITS, digitEntry, keyEntry } from './commandSheet';

describe('명령 바코드 시트', () => {
  it('첫 절은 탭 F1~F6 — IME 켠 PC 에서 명령이 읽히는지 바로 확인한다', () => {
    expect(COMMAND_SHEET_SECTIONS[0].title).toBe('탭');
    expect(COMMAND_SHEET_SECTIONS[0].actions.map((a) => a.key)).toEqual(['F1', 'F2', 'F3', 'F4', 'F5', 'F6']);
  });

  it('절마다 키가 겹치지 않고, 모든 바코드가 그 키로 되읽힌다', () => {
    for (const section of COMMAND_SHEET_SECTIONS) {
      expect(() => assertUniqueKeys(section.actions.map((a) => ({ ...a, id: a.key })))).not.toThrow();
      for (const action of section.actions) {
        const entry = keyEntry(action);
        expect(parseCommand(entry.code)).toEqual({ kind: 'key', key: action.key });
        expect(entry.bits).toMatch(/^[01]+$/);
      }
    }
  });

  it('숫자 1~9, 0 순서로 싣고 각각 숫자 명령으로 되읽힌다', () => {
    expect(SHEET_DIGITS).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 0]);
    for (const digit of SHEET_DIGITS) expect(parseCommand(digitEntry(digit).code)).toEqual({ kind: 'digit', digit });
  });

  it('Esc 는 시트에 Esc 로 적는다', () => {
    expect(keyEntry({ key: 'Escape', label: '내려놓기' }).caption).toBe('Esc');
  });
});
```

`src/station/CommandSheetScreen.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Barcode } from './Barcode';
import { CommandSheetScreen } from './CommandSheetScreen';
import { COMMAND_SHEET_SECTIONS, SHEET_DIGITS } from './commandSheet';

describe('Barcode', () => {
  it('연속한 1 을 막대 하나로, 좌우 10모듈 여백을 두고 그린다', () => {
    const { container } = render(<Barcode bits="1101" label="t" />);
    const bars = [...container.querySelectorAll('rect[fill="#000"]')].map((r) => [r.getAttribute('x'), r.getAttribute('width')]);
    expect(bars).toEqual([
      ['10', '2'],
      ['13', '1'],
    ]);
    expect(container.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 24 64');
  });
});

describe('CommandSheetScreen', () => {
  it('절마다 명령 바코드를, 끝에 숫자 10개를 그리고 인쇄는 OS 대화상자를 연다', () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    render(<CommandSheetScreen />);
    const actionCount = COMMAND_SHEET_SECTIONS.reduce((n, s) => n + s.actions.length, 0);
    expect(screen.getAllByRole('img')).toHaveLength(actionCount + SHEET_DIGITS.length);
    for (const section of COMMAND_SHEET_SECTIONS)
      expect(screen.getByRole('heading', { name: section.title })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '인쇄' }));
    expect(print).toHaveBeenCalledTimes(1);
    print.mockRestore();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/station/commandSheet.test.ts src/station/CommandSheetScreen.test.tsx`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`src/station/commandSheet.ts`:

```ts
import type { ActionSpec } from './actions';
import { encodeCode128B } from './code128';
import { commandCodeOfDigit, commandCodeOfKey } from './commandCode';
import { STATION_TABS } from './tabs';

export interface CommandSheetSection {
  title: string;
  actions: readonly Pick<ActionSpec, 'key' | 'label'>[];
}

/**
 * 시트에 싣는 명령(스펙 §5.3). 탭 화면이 액션을 선언하면 그 화면의 절을 여기 더한다(PR C 의 「출고 검수」 절처럼).
 * 탭 전환은 기능키로 충분하지만 첫 절로 둔다 — 한글 IME 켠 PC 에서 명령 바코드가 읽히는지 바로 확인할 수 있다.
 */
export const COMMAND_SHEET_SECTIONS: readonly CommandSheetSection[] = [
  { title: '탭', actions: STATION_TABS.map((tab) => ({ key: tab.key, label: tab.label })) },
];

/** 키패드처럼 1~9 다음 0. */
export const SHEET_DIGITS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0];

export interface SheetEntry {
  label: string;
  caption: string;
  code: string;
  bits: string;
}

export function keyEntry(action: Pick<ActionSpec, 'key' | 'label'>): SheetEntry {
  const code = commandCodeOfKey(action.key);
  return {
    label: action.label,
    caption: action.key === 'Escape' ? 'Esc' : action.key,
    code,
    bits: encodeCode128B(code),
  };
}

export function digitEntry(digit: number): SheetEntry {
  const code = commandCodeOfDigit(digit);
  return { label: String(digit), caption: '', code, bits: encodeCode128B(code) };
}
```

`src/station/Barcode.tsx`:

```tsx
/** Code128 최소 조용한 여백(10모듈). */
const QUIET = 10;

/** 모듈 비트열을 SVG 막대로 그린다. 인쇄에서 막대가 번지지 않게 crispEdges. */
export function Barcode({
  bits,
  label,
  moduleWidth = 2,
  height = 64,
}: {
  bits: string;
  label: string;
  moduleWidth?: number;
  height?: number;
}) {
  const bars: { x: number; width: number }[] = [];
  for (let i = 0; i < bits.length; ) {
    if (bits[i] !== '1') {
      i++;
      continue;
    }
    let j = i;
    while (j < bits.length && bits[j] === '1') j++;
    bars.push({ x: QUIET + i, width: j - i });
    i = j;
  }
  const modules = bits.length + QUIET * 2;
  return (
    <svg
      role="img"
      aria-label={label}
      width={modules * moduleWidth}
      height={height}
      viewBox={`0 0 ${modules} ${height}`}
      preserveAspectRatio="none"
      shapeRendering="crispEdges"
    >
      <rect width={modules} height={height} fill="#fff" />
      {bars.map((bar) => (
        <rect key={bar.x} x={bar.x} width={bar.width} height={height} fill="#000" />
      ))}
    </svg>
  );
}
```

`src/station/CommandSheetScreen.tsx`:

```tsx
import { Button } from '../core/design/Button';
import { Barcode } from './Barcode';
import { COMMAND_SHEET_SECTIONS, SHEET_DIGITS, digitEntry, keyEntry } from './commandSheet';

/**
 * 명령 바코드 시트(스펙 §5.3) — A4 를 OS 인쇄 대화상자로 뽑는다. 송장 프린터에는 송장 용지가 걸려 있어 쓰지 않는다.
 * 셸의 탭 바·기능키 바·상태바는 인쇄에서 빠진다(print:hidden).
 */
export function CommandSheetScreen() {
  return (
    <div className="mx-auto max-w-[210mm] space-y-4">
      <div className="flex items-center justify-between print:hidden">
        <h1 className="text-lg font-semibold">명령 바코드</h1>
        <Button onClick={() => window.print()}>인쇄</Button>
      </div>
      <article className="space-y-6 bg-white p-8 text-[#15171C] print:p-0">
        {COMMAND_SHEET_SECTIONS.map((section) => (
          <section key={section.title} className="space-y-3 break-inside-avoid">
            <h2 className="border-b-2 border-[#15171C] pb-2 text-2xl font-bold">{section.title}</h2>
            <div className="grid grid-cols-2 gap-4">
              {section.actions.map((action) => {
                const entry = keyEntry(action);
                return (
                  <div
                    key={entry.code}
                    className="flex flex-col gap-2 rounded-lg border border-[#C3C8D2] px-4 py-3 break-inside-avoid"
                  >
                    <div className="flex items-baseline justify-between">
                      <span className="text-xl font-bold">{entry.label}</span>
                      <span className="font-mono text-sm font-semibold text-[#535968]">{entry.caption}</span>
                    </div>
                    <Barcode bits={entry.bits} label={entry.label} />
                  </div>
                );
              })}
            </div>
          </section>
        ))}
        <section className="space-y-3 break-inside-avoid">
          <h2 className="border-b-2 border-[#15171C] pb-2 text-2xl font-bold">수량</h2>
          <div className="grid grid-cols-4 gap-2.5">
            {SHEET_DIGITS.map((digit) => {
              const entry = digitEntry(digit);
              return (
                <div
                  key={entry.code}
                  className="flex flex-col items-center gap-2 rounded-lg border border-[#C3C8D2] px-2 py-3 break-inside-avoid"
                >
                  <span className="font-mono text-3xl font-semibold">{entry.label}</span>
                  <Barcode bits={entry.bits} label={`숫자 ${entry.label}`} moduleWidth={1.3} height={44} />
                </div>
              );
            })}
          </div>
        </section>
      </article>
    </div>
  );
}
```

`routeTree.tsx` — import 와 라우트 추가(`settingsRoute` 정의 아래), children 목록 끝(`settingsRoute,` 다음)에 `commandSheetRoute,`:

```tsx
import { CommandSheetScreen } from '../station/CommandSheetScreen';
```

```tsx
// 스테이션 명령 바코드 시트(설정에서 연다). 어느 탭에도 속하지 않는다.
const commandSheetRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/station/command-sheet',
  component: CommandSheetScreen,
});
```

`SettingsRoute.tsx` — Task 6 에서 만든 스테이션 블록에 링크를 더한다:

```tsx
      {isStationDevice() && (
        <>
          <LabelPrinterSettings />
          <SoundSettings />
          <Link to="/station/command-sheet" className="text-sm font-medium text-blue-700 underline">
            명령 바코드 시트
          </Link>
        </>
      )}
```

`src/index.css` 끝에:

```css
/* 명령 바코드 시트(스테이션) — OS 인쇄 대화상자로 A4 한 장 */
@page {
  size: A4;
  margin: 12mm;
}
```

- [ ] **Step 4: 라우터 테스트에 진입 경로 추가**

`router.test.tsx` 끝에:

```tsx
it('스테이션 설정에서 명령 바코드 시트를 연다', async () => {
  const { session, setAuthed } = makeStub();
  setAuthed(true);
  const router = renderAppRouter(['/settings'], session);
  fireEvent.click(await screen.findByRole('link', { name: '명령 바코드 시트' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/station/command-sheet'));
  expect(await screen.findByRole('button', { name: '인쇄' })).toBeInTheDocument();
});
```

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run src/station src/app && npx tsc -b`
Expected: PASS, 타입 에러 0

- [ ] **Step 6: Commit**

```bash
git add src/station/commandSheet.ts src/station/commandSheet.test.ts src/station/Barcode.tsx src/station/CommandSheetScreen.tsx src/station/CommandSheetScreen.test.tsx src/app/routeTree.tsx src/app/routes/SettingsRoute.tsx src/app/router.test.tsx src/index.css
git commit -m "feat(warehouse-app): 명령 바코드 시트 — A4 로 뽑아 스캔한다"
```

---

### Task 11: 게이트와 PR

**Files:** 없음(검증·PR 본문만)

- [ ] **Step 1: 앱 타입 검사** — Run: `npx tsc -b` · Expected: 에러 0
- [ ] **Step 2: 앱 테스트 전체** — Run: `npx vitest run` · Expected: 실패 0 (기준선 111 files 에서 새 파일만큼 늘어난다)
- [ ] **Step 3: 앱 린트** — Run: `npx oxlint` · Expected: develop 의 경고 5건(AdjustStockScreen 2·QuickInboundScreen 1·SessionCountScreen 2) 외에 새 경고 0
- [ ] **Step 4: 앱 빌드** — Run: `npm run build` · Expected: 성공(`tsc -b && vite build`)
- [ ] **Step 5: 루트 게이트** — Run: `cd ../.. && npm run type-check && npx jest --maxWorkers=2` · Expected: 에러 0 · 실패 0 (`httpClient.ts` 가 루트 core 통합 스펙의 import 경로에 있다. ⚠️ tsc 증분 캐시가 가짜 에러를 내면 `rm -f tsconfig.tsbuildinfo` 후 다시)
- [ ] **Step 6: PR 생성** — base `develop`. 본문에 다음을 적는다:
  - 배포: **앱 릴리스만**. core·DB 변경 없음. PR A(#1010) 와 독립
  - 새 PR 게이트 `Warehouse app gates`(`native/warehouse-app/**` 변경 시)
  - **실기 확인(Windows 스테이션, 릴리스 빌드) — 모의 테스트로 대체하지 않는다(스펙 §10.3)**
    - [ ] 창이 1280×800 이상, 최대화로 시작한다
    - [ ] F1~F6 이 탭을 바꾼다. **F5 를 눌러도 새로고침되지 않는다**. F3 찾기·F7 캐럿 브라우징·F11 전체 화면·F12 개발자 도구가 뜨지 않는다
    - [ ] F10 을 누른 뒤 다음 스캔이 정상으로 읽힌다(창 메뉴 모드로 빠지지 않는다)
    - [ ] Alt+F4 로 창이 닫힌다
    - [ ] 한글 IME 를 켠 상태에서 송장·상품 바코드와 명령 바코드(시트의 「입고」 → F3 탭)가 모두 읽힌다
    - [ ] 설정 → 명령 바코드 시트 → 인쇄: OS 인쇄 대화상자가 뜨고 A4 한 장에 탭·숫자 바코드가 나오며, 인쇄물을 스캔하면 탭이 바뀌고 명령음이 난다
    - [ ] 모르는 바코드(`%` 로 시작하는 다른 것)·꺼진 키에 오류음이 들리고 빨간 테두리가 뜨며, 다음 스캔에서 사라진다. 설정의 음량·끄기가 먹는다
    - [ ] 상태바: 프린터 미설정이면 빨강, 설정하면 초록, 프린터 전원을 끄고 송장 재출력에 실패하면 빨강. 네트워크를 끊고 화면을 새로 조회하면 «서버» 빨강
    - [ ] 기존 화면(출고·입고·적치·되돌림 적치·이동·실사·재고 조회·설정)이 탭 안에서 지금처럼 동작한다
  - **대비책(실기에서 F5 새로고침이 막히지 않을 때):** `src-tauri/src/lib.rs` 의 `setup` 에서 `WebviewWindow::with_webview` 로 WebView2 설정의 `SetAreBrowserAcceleratorKeysEnabled(false)` 를 부른다(wry 0.55 가 이 설정을 갖고 있으나 tauri 2.11 설정 스키마엔 노출이 없다). 그래도 안 되면 스펙 §5.6 대로 F5 탭을 다른 키로 재배정한다

---

## PR C 에 넘기는 계약 메모

- **액션 선언:** 화면은 `useStationActions(actions)` 로 지금 상태의 액션을 선언한다. 렌더마다 새 배열이어도 되지만(서명 비교), 같은 층에서 키가 겹치면 던진다. 꺼진 액션(`enabled: false`)은 바에 안 그려지고 그 키·명령은 오류음이다
- **숫자 명령:** F7 수량 입력 중인 화면이 `useDigitCommands(handler)` 를 건다(`useCallback` 으로). 걸린 곳이 없으면 숫자 명령은 오류음이다
- **⚠️ 입력칸 포커스 중에는 스캔 버퍼가 아무것도 받지 않는다**(`ScanProvider` 가 입력칸 keydown 을 버린다) — 명령 바코드·상품 스캔 모두. 수량 입력을 «포커스된 입력칸» 으로 만들면 그동안 스캔이 죽는다. 키보드 숫자는 화면이 직접 keydown 으로 받거나, 입력칸이면 그 칸의 keydown 에서 `%` 접두어를 감지해야 한다
- **피드백:** `useFeedback().signal('success' | 'error' | 'complete' | 'command')`. 테두리는 다음 스캔에서 셸이 지운다 — 화면이 같은 스캔의 처리에서 낸 오류는 남는다
- **배치 진행:** F1·F2 화면이 `useBatchProgress({ code, done, total })` 를 부르면 상태바 오른쪽에 뜬다(다른 탭에선 안 보인다)
- **명령 시트:** F1 의 액션 스펙(키·라벨)을 `COMMAND_SHEET_SECTIONS` 에 「출고 검수」 절로 더한다. 모듈 상수로 둬서 화면 선언과 시트가 같은 값을 쓰게 할 것
- **F2:** `/outbound/batches` 가 지금은 `OutboundRoute` 를 그린다 — 배치 현황 화면으로 바꾼다
- **§5.6 대기 중 숫자 타이핑 → 직접 입력칸** 은 이 PR 이 넘겼다. F1 송장 대기 상태에서 구현한다(스캔 버퍼는 사람 타이핑을 버리므로 ScanProvider 에 «사람이 친 숫자» 신호를 더하는 것부터)
- 셸 밖(핸드헬드)에서 위 훅들은 전부 아무 일도 하지 않는다 — 공유 화면에서 불러도 핸드헬드가 바뀌지 않는다
