/**
 * 선반 로케이션 코드 꼴과 랙의 칸 집합 계산. 코드는 창고 자석 라벨의 바코드 값과 글자까지 같아야 한다
 * (적치 화면은 스캔 값과 locations.code 를 그대로 비교한다).
 *
 * scripts/ 의 tsx 가 이 파일을 직접 import 하므로 어떤 import 도 두지 않는다.
 */

/** `${열}-${랙 두 자리}-${칸}` — 예: A-01-01, Z-01-105, M-07-꼭대기 */
export function rackBinLocationCode(columnName: string, rackNumber: number, binIdentifier: string): string {
  return `${columnName}-${String(rackNumber).padStart(2, '0')}-${binIdentifier}`;
}

/** 자동 생성 칸 이름. 최소 두 자리 — 99 까지 `05`, 100 부터 `105`. 현장 자석 꼴과 같다. */
export function autoBinIdentifier(n: number): string {
  return String(n).padStart(2, '0');
}

/** 숫자뿐인 칸만 «번호 칸»이다. 꼭대기·맨뒤 같은 커스텀 칸은 칸 맞추기에서 건드리지 않는다. */
export function isNumericBin(binIdentifier: string): boolean {
  return /^\d+$/.test(binIdentifier);
}

/**
 * 랙의 숫자 칸을 `start..end` 에 맞추려면 무엇을 만들고 무엇을 지울 후보로 볼지.
 * 번호로 비교한다 — 같은 번호를 다른 자릿수로 쓴 칸(`5`)이 있으면 `05` 를 또 만들지 않는다(한 칸에 이름 하나).
 * 지울지는 후보마다 «사용 중» 판정을 거쳐 호출자가 정한다.
 */
export function planRackBinSync(input: {
  start: number;
  end: number;
  existing: { id: string; binIdentifier: string }[];
}): { createBinIdentifiers: string[]; deleteCandidateIds: string[] } {
  const numeric = input.existing.filter((b) => isNumericBin(b.binIdentifier));
  const present = new Set(numeric.map((b) => Number.parseInt(b.binIdentifier, 10)));

  const createBinIdentifiers: string[] = [];
  for (let n = input.start; n <= input.end; n++) {
    if (!present.has(n)) createBinIdentifiers.push(autoBinIdentifier(n));
  }
  const deleteCandidateIds = numeric
    .filter((b) => {
      const n = Number.parseInt(b.binIdentifier, 10);
      return n < input.start || n > input.end;
    })
    .map((b) => b.id);

  return { createBinIdentifiers, deleteCandidateIds };
}
