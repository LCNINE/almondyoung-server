import { maskPiiValue } from './mask';
import type { PiiKind, PiiPath } from './pii-kinds';

export interface PathSegment {
  /** null = 응답 자체(맨 앞 `[]`), `*` = 객체의 모든 값(이름이 키인 묶음). */
  readonly key: string | null;
  /** 이 키의 값이 배열이고 원소마다 내려간다. */
  readonly each: boolean;
}

const SEGMENT = /^([A-Za-z0-9_$-]+|\*)(\[\])?$/;

/** 경로 문법을 검사한다. 선언(데코레이터) 시점에 부르므로 오타는 부팅에서 드러난다. */
export function parsePiiPath(path: PiiPath): PathSegment[] {
  if (path === '' || path === '[]') throw new Error(`Invalid PII path: "${path}"`);
  const rootArray = path.startsWith('[].');
  const rest = rootArray ? path.slice(3) : path;
  const segments: PathSegment[] = rootArray ? [{ key: null, each: true }] : [];
  for (const part of rest.split('.')) {
    const match = SEGMENT.exec(part);
    if (!match) throw new Error(`Invalid PII path: "${path}"`);
    segments.push({ key: match[1], each: match[2] === '[]' });
  }
  return segments;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  return true;
}

/** 경로의 값들을 모은다(배열은 펼친다). 없는 가지는 건너뛴다. */
export function readPathValues(body: unknown, path: PiiPath): unknown[] {
  const out: unknown[] = [];
  walk(body, parsePiiPath(path), 0, (value) => out.push(value));
  return out;
}

function walk(node: unknown, segments: readonly PathSegment[], index: number, visit: (value: unknown) => void): void {
  const segment = segments[index];
  const handle = (value: unknown): void => {
    if (segment.each) {
      if (!Array.isArray(value)) return;
      for (const item of value) {
        if (index === segments.length - 1) visit(item);
        else walk(item, segments, index + 1, visit);
      }
      return;
    }
    if (index === segments.length - 1) {
      if (value !== undefined) visit(value);
      return;
    }
    walk(value, segments, index + 1, visit);
  };
  if (segment.key === null) handle(node);
  else if (!isRecord(node)) return;
  else if (segment.key === '*') Object.values(node).forEach(handle);
  else handle(node[segment.key]);
}

/** 선언된 경로 중 «값이 실제로 있는» 개수 — 원문을 내보낼 때 기록이 필요한지 판단한다. 복사하지 않는다. */
export function countRawValues(body: unknown, fields: Readonly<Record<PiiPath, PiiKind>>): number {
  let count = 0;
  for (const path of Object.keys(fields)) {
    walk(body, parsePiiPath(path), 0, (value) => {
      if (isPresent(value)) count += 1;
    });
  }
  return count;
}

export interface MaskResult {
  readonly body: unknown;
  readonly maskedKinds: PiiKind[];
  readonly redactedPaths: PiiPath[];
  readonly maskedValueCount: number;
}

/** 선언된 경로를 가린 «사본»을 만든다. 입력은 바꾸지 않는다(지나는 가지만 복사한다). */
export function maskPaths(body: unknown, fields: Readonly<Record<PiiPath, PiiKind>>): MaskResult {
  const kinds = new Set<PiiKind>();
  const redacted = new Set<PiiPath>();
  let maskedValueCount = 0;
  let current = body;
  for (const [path, kind] of Object.entries(fields)) {
    current = rewrite(current, parsePiiPath(path), 0, (value) => {
      if (!isPresent(value)) return value;
      maskedValueCount += 1;
      if (kind !== 'redact' && typeof value === 'string') {
        kinds.add(kind);
        return maskPiiValue(kind, value);
      }
      kinds.add('redact');
      redacted.add(path);
      return null;
    });
  }
  return { body: current, maskedKinds: [...kinds], redactedPaths: [...redacted], maskedValueCount };
}

function rewrite(
  node: unknown,
  segments: readonly PathSegment[],
  index: number,
  replace: (value: unknown) => unknown,
): unknown {
  const segment = segments[index];
  const last = index === segments.length - 1;
  const step = (value: unknown): unknown => (last ? replace(value) : rewrite(value, segments, index + 1, replace));
  const descend = (value: unknown): unknown => {
    if (!segment.each) return step(value);
    return Array.isArray(value) ? value.map(step) : value;
  };
  if (segment.key === null) return descend(node);
  if (!isRecord(node)) return node;
  if (segment.key === '*') return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, descend(value)]));
  if (!(segment.key in node)) return node;
  return { ...node, [segment.key]: descend(node[segment.key]) };
}
