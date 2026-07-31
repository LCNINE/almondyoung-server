/**
 * 워크북 본문 마크다운의 `::product-image{imageKey="IMG-n"}` 디렉티브를 다룬다.
 *
 * 기존 `@packages/product-description` 의 파서는 **mdast 노드**를 받는다(remark-directive
 * 파싱 이후). 임포터는 셀에서 읽은 원문 문자열만 갖고 있으므로 텍스트 레벨로 따로 다룬다 —
 * 마크다운 파서를 임포트 경로에 끌어들이지 않기 위해서다.
 *
 * `imageKey` 는 **워크북 스코프**다. AI/MD 가 바이너리나 UUID 를 다루지 않게 하는 것이
 * 이 간접참조의 목적이고, 커밋 시점에 여기서 fileId 로 바뀐다(스펙 §2.4·§3.1).
 */

/** `::product-image{...}` 한 덩어리. 중괄호 안에 중괄호가 없다는 전제는 디렉티브 문법이 보장한다. */
const DIRECTIVE_RE = /::product-image\{([^}]*)\}/g;
/** 속성 하나. 순서에 의존하지 않으려고 attrs 안에서 따로 찾는다. */
const IMAGE_KEY_ATTR_RE = /imageKey\s*=\s*"([^"]*)"/;

export function extractDirectiveImageKeys(markdown: string | undefined): string[] {
  if (!markdown) return [];
  const keys: string[] = [];
  const seen = new Set<string>();
  // 전역 정규식은 lastIndex 를 들고 있다 — 모듈 상수를 여러 호출이 공유하므로
  // matchAll 로 새 이터레이터를 만든다(exec 루프를 쓰면 호출 간에 상태가 샌다).
  for (const match of markdown.matchAll(DIRECTIVE_RE)) {
    const attr = IMAGE_KEY_ATTR_RE.exec(match[1]);
    const key = attr?.[1]?.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

export function replaceDirectiveImageKeys(markdown: string, fileIdByKey: ReadonlyMap<string, string>): string {
  return markdown.replace(DIRECTIVE_RE, (whole, attrs: string) => {
    const attr = IMAGE_KEY_ATTR_RE.exec(attrs);
    if (!attr) return whole;
    const key = attr[1]?.trim();
    if (!key) return whole;
    const fileId = fileIdByKey.get(key);
    // 맵에 없으면 그대로 둔다. 이 상황은 호출부가 이미 그 행을 실패시켰다는 뜻이라
    // (unresolvedImageError) 여기서 또 판단하지 않는다 — 판단 지점을 하나로 모은다.
    if (!fileId) return whole;
    return whole.replace(attr[0], `fileId="${fileId}"`);
  });
}
