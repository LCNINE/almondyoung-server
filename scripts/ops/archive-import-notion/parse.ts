/**
 * 노션 export 트리를 읽어 «무엇이 몇 건 생기는지»까지 계산한다.
 *
 * 두 패스로 나눈 이유는 링크 때문이다. 본문의 문서 참조는 다른 `.md` 를 상대경로로
 * 가리키는데, 그 대상이 아직 우리 페이지로 안 만들어졌으면 풀 수가 없다. 그래서
 * 1패스에서 트리와 «노션 경로 → 우리 페이지» 맵을 먼저 만들고, 2패스에서 본문을 옮긴다.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/** 노션은 파일명 끝에 32자리 hex 로 자기 페이지 id 를 붙인다. 예외는 확인된 바 없다. */
const NOTION_NAME = /^(.*) ([0-9a-f]{32})(_all)?$/;

type MarkdownLink = {
  /** 이미지면 true — 마크다운에서 `!` 가 앞에 붙는다. */
  image: boolean;
  label: string;
  href: string;
  /** 원문에서 링크가 차지한 구간. «문단 전체가 링크 하나»를 판정하는 데 쓴다. */
  start: number;
  end: number;
};

/**
 * 한 줄에서 `[제목](경로)` 를 뽑는다.
 *
 * 정규식으로 `\(([^)]*)\)` 를 쓰면 안 된다 — 노션 파일 이름에는 괄호가 그대로
 * 들어 있어서(「…회원권 등)」) 첫 `)` 에서 잘리고, 그 경로는 디스크에 없는 이름이 된다.
 * 마크다운은 괄호가 짝이 맞으면 경로 안에 허용하므로 깊이를 세어야 한다.
 */
function scanLinks(line: string): MarkdownLink[] {
  const links: MarkdownLink[] = [];

  for (let i = 0; i < line.length; i += 1) {
    if (line[i] !== '[') continue;

    const labelEnd = line.indexOf(']', i);
    if (labelEnd === -1 || line[labelEnd + 1] !== '(') continue;

    let depth = 1;
    let cursor = labelEnd + 2;
    while (cursor < line.length && depth > 0) {
      if (line[cursor] === '(') depth += 1;
      else if (line[cursor] === ')') depth -= 1;
      cursor += 1;
    }
    if (depth !== 0) continue;

    const image = i > 0 && line[i - 1] === '!';
    links.push({
      image,
      label: line.slice(i + 1, labelEnd),
      href: line.slice(labelEnd + 2, cursor - 1),
      start: image ? i - 1 : i,
      end: cursor,
    });
    i = cursor - 1;
  }

  return links;
}

export type NotionPage = {
  /** export 루트로부터의 상대경로. 링크 해석의 열쇠라 정규화해서 들고 있는다. */
  relPath: string;
  title: string;
  notionId: string;
  /** 자식들이 들어 있는 폴더의 경로. 노션은 여기에 id 를 안 붙인다. */
  folderPath: string;
  parentRelPath: string | null;
  /** 루트를 0 으로 세는 깊이. 부모 사슬을 따라 센다. */
  depth: number;
  markdown: string;
};

export type PageLinkRef = { targetRelPath: string; label: string };

export type ConvertedPage = {
  page: NotionPage;
  /** 문단 전체가 문서 링크 하나 — 노션에서 «본문 안 하위 페이지»로 보이던 것. */
  subPageLinks: PageLinkRef[];
  /** 문장 속 문서 링크 — 참조다. */
  inlineLinks: PageLinkRef[];
  /** 본문이 참조하는 첨부 파일(디스크에 실제로 있는 경로). 중복 참조가 있다. */
  assetRefs: string[];
  /** 본문이 가리키는데 디스크에 없는 첨부. 있으면 그 이미지는 반입에서 빠진다. */
  missingAssets: string[];
  /** 노션 DB(표) 페이지로 가는 링크. `.md` 가 아니라 `.csv` 로 나온다. */
  databaseLinks: { raw: string; resolved: string }[];
  /** 어느 쪽으로도 못 푼 링크. 0 건이 아니면 경로 정규화가 틀린 것이다. */
  unresolved: { raw: string; resolved: string }[];
  calloutCount: number;
};

function isDirectory(target: string): boolean {
  try {
    return statSync(target).isDirectory();
  } catch {
    return false;
  }
}

/**
 * 추출 스크립트가 200바이트 넘는 이름을 줄여 놨다(ext4 의 한 컴포넌트 상한).
 * 본문 링크는 «줄이기 전» 이름을 가리키므로 조회 전에 같은 규칙으로 줄여야 맞는다.
 */
export function shortenComponent(component: string): string {
  if (Buffer.byteLength(component, 'utf8') <= 200) return component;

  const ext = path.extname(component);
  const root = component.slice(0, component.length - ext.length);
  const hash = createHash('sha1').update(component).digest('hex').slice(0, 8);

  let bytes = Buffer.from(root, 'utf8').subarray(0, 150);
  let head = bytes.toString('utf8');
  // 잘린 자리가 멀티바이트 한가운데면 대체 문자가 남는다. 온전한 글자까지 물러선다.
  while (head.endsWith('�')) {
    bytes = bytes.subarray(0, bytes.length - 1);
    head = bytes.toString('utf8');
  }

  return `${head}~${hash}${ext}`;
}

function shortenPath(relPath: string): string {
  return relPath.split('/').map(shortenComponent).join('/');
}

/**
 * 1패스 — 트리 조립.
 *
 * 노션은 자식을 가진 페이지를 «같은 이름의 `.md` + 같은 이름의 폴더» 짝으로 낸다.
 * 그래서 부모는 「내가 들어 있는 폴더와 같은 이름의 `.md`」로 규칙만으로 찾힌다.
 */
export function collectPages(exportRoot: string): NotionPage[] {
  const pages: NotionPage[] = [];

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir).sort()) {
      const abs = path.join(dir, entry);
      if (isDirectory(abs)) {
        walk(abs);
        continue;
      }
      if (!entry.endsWith('.md')) continue;

      const parsed = NOTION_NAME.exec(entry.slice(0, -3));
      if (!parsed) {
        throw new Error(`페이지 이름 규칙에 안 맞는 파일: ${abs}`);
      }

      const relPath = path.relative(exportRoot, abs).split(path.sep).join('/');

      pages.push({
        relPath,
        title: parsed[1],
        notionId: parsed[2],
        // 자식은 «id 를 뗀 제목» 폴더 안에 들어간다. 부모는 2단계에서 이걸로 잇는다.
        folderPath: path.posix.join(path.posix.dirname(relPath), parsed[1]),
        parentRelPath: null,
        depth: 0,
        markdown: readFileSync(abs, 'utf8'),
      });
    }
  };

  walk(exportRoot);
  linkParents(pages);
  return pages;
}

/**
 * 부모를 잇는다. 노션은 자식 폴더 이름에서 32hex 를 떼므로 «내가 있는 폴더 =
 * 부모의 제목 폴더»로 찾는다. 파일명만 보고 `<폴더>.md` 를 찾으면 하나도 안 맞는다.
 */
function linkParents(pages: NotionPage[]) {
  const byFolder = new Map(pages.map((page) => [page.folderPath, page]));
  const byRelPath = new Map(pages.map((page) => [page.relPath, page]));

  for (const page of pages) {
    const parent = byFolder.get(path.posix.dirname(page.relPath));
    page.parentRelPath = parent && parent !== page ? parent.relPath : null;
  }

  for (const page of pages) {
    let depth = 0;
    let cursor: NotionPage | undefined = page;
    const seen = new Set<string>();
    while (cursor?.parentRelPath && !seen.has(cursor.relPath)) {
      seen.add(cursor.relPath);
      cursor = byRelPath.get(cursor.parentRelPath);
      depth += 1;
    }
    page.depth = depth;
  }
}

/**
 * 첨부를 실제 파일에 맞춘다. 추출 때 줄인 이름(255바이트 초과)은 본문 링크와 다르므로
 * 같은 규칙으로 줄인 경로도 같이 본다. 그래도 없으면 «없는 첨부»로 남겨 사람이 판단한다.
 */
function pushAsset(result: ConvertedPage, exportRoot: string, resolved: string) {
  for (const candidate of [resolved, shortenPath(resolved)]) {
    if (existsSync(path.join(exportRoot, candidate))) {
      result.assetRefs.push(candidate);
      return;
    }
  }
  result.missingAssets.push(resolved);
}

/** 링크 경로를 export 루트 기준 상대경로로 편다. 못 펴면 null. */
function resolveTarget(fromRelPath: string, href: string): string | null {
  // 노션 링크는 URL 인코딩돼 있고, 외부 링크는 스킴이 붙어 있다.
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#')) return null;

  let decoded: string;
  try {
    decoded = decodeURIComponent(href);
  } catch {
    decoded = href;
  }

  const base = path.posix.dirname(fromRelPath);
  const joined = path.posix.normalize(path.posix.join(base, decoded));
  return joined.startsWith('..') ? null : joined;
}

/**
 * 2패스 — 본문을 훑어 링크를 가른다.
 *
 * 문단 전체가 문서 링크 하나면 «소유»(하위 페이지 블록), 문장 속이면 «참조»(인라인 링크)다.
 * 노션 본문에 두 형태가 실제로 섞여 있어서 그릇도 둘로 나뉜다.
 */
export function convertPage(page: NotionPage, byRelPath: Map<string, NotionPage>, exportRoot: string): ConvertedPage {
  const result: ConvertedPage = {
    page,
    subPageLinks: [],
    inlineLinks: [],
    assetRefs: [],
    missingAssets: [],
    databaseLinks: [],
    unresolved: [],
    calloutCount: (page.markdown.match(/<aside>/g) ?? []).length,
  };

  for (const rawLine of page.markdown.split('\n')) {
    const line = rawLine.trim();
    const links = scanLinks(line);
    if (links.length === 0) continue;

    // 문단 전체가 링크 하나인가 — 앞뒤에 다른 글자가 없어야 한다.
    const onlyLink = links.length === 1 && links[0].start === 0 && links[0].end === line.length;

    for (const { image, label, href } of links) {
      const resolved = resolveTarget(page.relPath, href);
      if (resolved === null) continue;

      if (image) {
        pushAsset(result, exportRoot, resolved);
        continue;
      }

      const target = byRelPath.get(resolved) ?? byRelPath.get(shortenPath(resolved));
      if (!target) {
        // 문서가 아니면 첨부다 — 노션은 파일 첨부도 평범한 링크로 낸다.
        if (!resolved.endsWith('.md')) {
          pushAsset(result, exportRoot, resolved);
          continue;
        }
        // 노션 DB(표) 페이지는 `.md` 이름으로 링크되지만 `.csv` 로 나온다.
        if (existsSync(path.join(exportRoot, resolved.replace(/\.md$/, '.csv')))) {
          result.databaseLinks.push({ raw: href, resolved });
          continue;
        }
        result.unresolved.push({ raw: href, resolved });
        continue;
      }

      const ref = { targetRelPath: target.relPath, label };
      if (onlyLink) result.subPageLinks.push(ref);
      else result.inlineLinks.push(ref);
    }
  }

  return result;
}
