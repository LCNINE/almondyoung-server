import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const DEFAULT_MAX_ENTRIES = 5000;

/**
 * 키 순서에 흔들리지 않는 표준형. 스냅샷은 여러 자리에서 조립되므로 같은 내용이
 * 다른 키 순서로 올 수 있고, 그때 재보장이 일어나면 이 메모가 무의미해진다.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(source)
        .sort()
        .map((key) => [key, canonicalize(source[key])]),
    );
  }

  return value;
}

/**
 * 카테고리 보장(ensure)을 내용이 바뀌었을 때만 실제로 수행한다.
 *
 * CategoryChanged 핸들러는 이벤트마다 조상 체인을 루트부터 다시 보장하는데, 한 부모의
 * 자손 96건이 한꺼번에 들어오면 그 부모를 똑같은 내용으로 96번 다시 쓴다 (실측 2026-08-14:
 * 이벤트당 Medusa 카테고리 호출 8.2회 중 약 64%가 조상 재보장, POST 갱신만 이벤트당 2.62회).
 *
 * TTL 이 없는 이유: Medusa admin 에서 카테고리를 직접 고치는 것은 내부적으로 금지돼 있어,
 * "우리가 마지막으로 쓴 내용"이 곧 Medusa 의 상태다. 그 전제가 깨지는 경로(삭제)는
 * invalidate 로 명시적으로 지운다. 프로세스 재시작이 메모를 통째로 비우는 것도 안전 밸브다.
 *
 * 락은 두지 않는다. 인박스 핸들러가 동시에 2개 돌므로 같은 조상을 두 핸들러가 함께 놓쳐
 * 두 번 보장할 수 있는데, 같은 내용을 두 번 쓰는 것뿐이라 결과가 달라지지 않는다.
 */
@Injectable()
export class CategoryEnsureMemoService {
  /** categoryId → 마지막으로 성공적으로 보장한 스냅샷의 표준형 문자열. 삽입 순서 = 축출 순서. */
  private readonly remembered = new Map<string, string>();
  private readonly maxEntries: number;

  constructor(configService: ConfigService) {
    const raw = configService.get<string | number | undefined>('CATEGORY_ANCESTOR_MEMO_MAX_ENTRIES');
    const parsed = Number(raw);
    this.maxEntries =
      raw === undefined || raw === null || raw === '' || !Number.isInteger(parsed) || parsed < 0
        ? DEFAULT_MAX_ENTRIES
        : parsed;
  }

  /**
   * 내용이 직전 보장과 같으면 `ensure` 를 부르지 않는다.
   *
   * 기억은 `ensure` 가 성공한 뒤에만 남긴다 — 실패한 보장을 기억하면 그 카테고리가
   * 다음 이벤트까지 잘못된 상태로 굳는다.
   */
  async ensureOnce(categoryId: string, snapshot: object, ensure: () => Promise<unknown>): Promise<void> {
    if (this.maxEntries === 0) {
      await ensure();
      return;
    }

    const fingerprint = JSON.stringify(canonicalize(snapshot));

    if (this.remembered.get(categoryId) === fingerprint) {
      return;
    }

    await ensure();

    this.remembered.set(categoryId, fingerprint);
    this.evictOverflow();
  }

  /** 메모 밖에서 카테고리가 바뀐 경우(삭제 등) 다음 보장이 실제로 나가게 한다. */
  invalidate(categoryId: string): void {
    this.remembered.delete(categoryId);
  }

  private evictOverflow(): void {
    while (this.remembered.size > this.maxEntries) {
      const oldest = this.remembered.keys().next();
      if (oldest.done) {
        return;
      }
      this.remembered.delete(oldest.value);
    }
  }
}
