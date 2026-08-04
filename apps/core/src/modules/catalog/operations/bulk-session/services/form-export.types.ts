/**
 * 워크북 한 행. 키는 ColumnDef.key 이고 값은 **항상 문자열**이다.
 * 숫자·날짜를 셀에 그대로 넣으면 exceljs 가 로케일·TZ 의존 서식으로 되돌려주므로
 * (cell.text 가 Date.prototype.toString() 이다) 조립 단계에서 규격 문자열로 굳힌다.
 */
export type PrefillCell = string;

export type PrefillRow = Record<string, PrefillCell>;

export interface PrefillWorkbookData {
  /** null 이면 빈 양식이다 — 숨은 메타 시트를 만들지 않아 업로드가 신규 전용 세션으로 읽는다. */
  exportId: string | null;
  products: PrefillRow[];
  options: PrefillRow[];
  variants: PrefillRow[];
  categories: PrefillRow[];
  constraints: PrefillRow[];
  images: PrefillRow[];
  /** 카테고리 참조 시트용. '여성패션>니트' 형태의 전체 경로 목록. */
  categoryPaths: string[];
}

/**
 * 상품 하나가 워크북에 만든 행 전량. 양식 잡이 이걸 그대로 스냅샷으로 저장하고(§6 대응),
 * 2단계가 '현재 active' 도 같은 shape 으로 다시 그려 비교한다.
 *
 * 값이 전부 문자열인 것이 핵심이다 — jsonb 왕복에서 타입이 변하지 않고, 비교가 문자열
 * 등호 하나로 끝나며, 워크북 셀과 1:1 이라 "무엇이 바뀌었나"가 사람이 본 것과 일치한다.
 */
export interface PrefillBundle {
  product: PrefillRow;
  options: PrefillRow[];
  variants: PrefillRow[];
  categories: PrefillRow[];
  /** 구매제약은 상품당 최대 1행이다. 없으면 null. */
  constraint: PrefillRow | null;
  /** 이 상품이 참조하는 imageKey → fileId. 2단계가 '현재' 렌더의 키 할당을 여기에 맞춘다. */
  images: Record<string, string>;
}

/**
 * fileId → imageKey 할당기. 이미지 시트는 워크북 **전역**이라 키도 전역으로 유일해야
 * 한다(같은 fileId 를 두 상품이 쓰면 키 하나로 합쳐진다 — 의도한 동작).
 *
 * 2단계가 '현재 active' 를 다시 그릴 때는 **스냅샷의 키 배정을 seed 로 넣는다**. 안 그러면
 * 안 바뀐 이미지가 IMG-1 부터 다시 번호를 받아 '대표이미지키' 셀이 항상 달라 보이고,
 * 이미지를 건드리지도 않은 행이 전부 충돌로 뜬다.
 */
export interface ImageKeyAllocator {
  keyFor(fileId: string): string;
  entries(): Array<{ imageKey: string; fileId: string }>;
}

export function createImageKeyAllocator(seed: Record<string, string> = {}): ImageKeyAllocator {
  const keyByFileId = new Map<string, string>();
  let maxIndex = 0;
  for (const [imageKey, fileId] of Object.entries(seed)) {
    keyByFileId.set(fileId, imageKey);
    // seed 된 키 번호 뒤에서 이어 붙인다 — IMG-3 이 있는데 새 키가 IMG-3 이 되면
    // 서로 다른 파일이 한 키를 가리켜 워크북이 스스로 모순된다.
    const parsed = Number.parseInt(imageKey.replace(/^IMG-/, ''), 10);
    if (Number.isInteger(parsed) && parsed > maxIndex) maxIndex = parsed;
  }
  return {
    keyFor(fileId: string): string {
      const existing = keyByFileId.get(fileId);
      if (existing) return existing;
      maxIndex += 1;
      const key = `IMG-${maxIndex}`;
      keyByFileId.set(fileId, key);
      return key;
    },
    entries(): Array<{ imageKey: string; fileId: string }> {
      return [...keyByFileId].map(([fileId, imageKey]) => ({ imageKey, fileId }));
    },
  };
}
