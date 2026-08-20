import {
  ENTRANCE_PASSWORD_CANDIDATE_SQL,
  ENTRANCE_PASSWORD_CART_CANDIDATE_SQL,
  ENTRANCE_PASSWORD_CART_COUNT_SQL,
  ENTRANCE_PASSWORD_COUNT_SQL,
  ENTRANCE_PASSWORD_METADATA_KEY,
  ENTRANCE_PASSWORD_TTL_DAYS,
  METADATA_DELETE_SENTINEL,
  PURGE_ALL_CONFIRM_TOKEN,
  buildEntrancePasswordPurgeUpdates,
  chunk,
  entrancePasswordCutoff,
  expiredEntrancePasswordRowIds,
  isEntrancePasswordExpired,
  parseEntrancePasswordPurgeArgs,
} from '../entrance-password-purge';

const NOW = new Date('2026-08-21T00:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

/** SQL 의 select 목록(= 실제로 프로세스 메모리에 들어오는 컬럼)만 잘라낸다. */
function projectionOf(sql: string): string {
  const start = sql.toLowerCase().indexOf('select') + 'select'.length;
  const end = sql.toLowerCase().indexOf(' from ');
  return sql.slice(start, end);
}

describe('entrance password purge helpers', () => {
  describe('보관 상한', () => {
    it('core 의 ENTRANCE_PASSWORD_TTL_DAYS 와 같은 14일이다', () => {
      // apps/core/.../entrance-password-expiry.ts 와 같은 값이어야 한다. 앱 경계를 넘어
      // import 하지 않으므로 숫자가 두 곳에 적히고, 이 테스트가 드리프트를 잡는다.
      expect(ENTRANCE_PASSWORD_TTL_DAYS).toBe(14);
    });

    it('컷오프는 now - 14일이다', () => {
      expect(entrancePasswordCutoff(NOW).toISOString()).toBe('2026-08-07T00:00:00.000Z');
    });

    it('정확히 14일 된 주문은 만료이고 1ms 어린 주문은 아니다', () => {
      expect(isEntrancePasswordExpired(new Date(NOW.getTime() - 14 * DAY_MS), NOW)).toBe(true);
      expect(isEntrancePasswordExpired(new Date(NOW.getTime() - 14 * DAY_MS + 1), NOW)).toBe(false);
    });

    it('드라이버가 created_at 을 문자열로 돌려줘도 같은 판정을 한다', () => {
      expect(isEntrancePasswordExpired('2026-06-17T09:00:00.000Z', NOW)).toBe(true);
      expect(isEntrancePasswordExpired('2026-08-20T09:00:00.000Z', NOW)).toBe(false);
    });
  });

  describe('expiredEntrancePasswordRowIds', () => {
    it('만료된 주문 id 만, 입력 순서를 유지해 돌려준다', () => {
      expect(
        expiredEntrancePasswordRowIds(
          [
            { id: 'order_old', created_at: new Date('2026-06-17T00:00:00.000Z') },
            { id: 'order_fresh', created_at: new Date('2026-08-20T00:00:00.000Z') },
            { id: 'order_edge', created_at: new Date('2026-08-07T00:00:00.000Z') },
          ],
          NOW,
        ),
      ).toEqual(['order_old', 'order_edge']);
    });

    it('후보가 없으면 빈 배열이다 (두 번째 실행에서 아무 것도 하지 않게 한다)', () => {
      expect(expiredEntrancePasswordRowIds([], NOW)).toEqual([]);
    });
  });

  describe('buildEntrancePasswordPurgeUpdates', () => {
    it('빈 문자열을 써서 키 자체를 삭제한다 (null 은 값을 null 로 저장할 뿐이다)', () => {
      expect(buildEntrancePasswordPurgeUpdates(['order_1', 'order_2'])).toEqual([
        { id: 'order_1', metadata: { entrance_password: '' } },
        { id: 'order_2', metadata: { entrance_password: '' } },
      ]);
      expect(METADATA_DELETE_SENTINEL).toBe('');
      expect(ENTRANCE_PASSWORD_METADATA_KEY).toBe('entrance_password');
    });

    it('페이로드에 비번 키 말고 다른 키를 절대 싣지 않는다', () => {
      const [update] = buildEntrancePasswordPurgeUpdates(['order_1']);
      expect(Object.keys(update)).toEqual(['id', 'metadata']);
      expect(Object.keys(update.metadata)).toEqual([ENTRANCE_PASSWORD_METADATA_KEY]);
    });

    it('id 가 없으면 빈 배열이다 — 호출자가 updateOrders 를 건너뛸 수 있다', () => {
      expect(buildEntrancePasswordPurgeUpdates([])).toEqual([]);
    });
  });

  describe('값 유출 방지', () => {
    it('후보 조회는 id 와 created_at 만 가져온다 — 비번 값은 프로세스에 들어오지 않는다', () => {
      for (const sql of [ENTRANCE_PASSWORD_CANDIDATE_SQL, ENTRANCE_PASSWORD_CART_CANDIDATE_SQL]) {
        const projection = projectionOf(sql);
        expect(projection).not.toContain('metadata');
        expect(projection).not.toContain(ENTRANCE_PASSWORD_METADATA_KEY);
        expect(
          projection
            .split(',')
            .map((column) => column.trim())
            .filter(Boolean),
        ).toEqual(['id', 'created_at']);
      }
    });

    it('건수 조회도 값을 가져오지 않는다', () => {
      for (const sql of [ENTRANCE_PASSWORD_COUNT_SQL, ENTRANCE_PASSWORD_CART_COUNT_SQL]) {
        const projection = projectionOf(sql);
        expect(projection).not.toContain('metadata');
        expect(projection).toContain('count(*)');
      }
    });

    it('네 SQL 모두 이미 비워진 행을 후보에서 뺀다 (재실행 시 0건)', () => {
      for (const sql of [
        ENTRANCE_PASSWORD_CANDIDATE_SQL,
        ENTRANCE_PASSWORD_COUNT_SQL,
        ENTRANCE_PASSWORD_CART_CANDIDATE_SQL,
        ENTRANCE_PASSWORD_CART_COUNT_SQL,
      ]) {
        expect(sql).toContain(`nullif(metadata->>'${ENTRANCE_PASSWORD_METADATA_KEY}', '') is not null`);
        expect(sql).toContain('deleted_at is null');
      }
    });
  });

  /**
   * 카트도 통과점이다 — 체크아웃이 `cart.metadata.entrance_password` 를 먼저 쓰고
   * `complete-cart` 가 그걸 주문으로 복사한다. 주문만 파기하면 모든 주문의 비번이 카트에
   * 영구 쌍둥이로 남고, 메모 단계까지 갔다가 버려진 카트에도 그대로 남는다.
   */
  describe('카트 통과점', () => {
    it('카트 SQL 은 cart 테이블을 본다 — 주문 SQL 과 테이블만 다르다', () => {
      expect(ENTRANCE_PASSWORD_CART_CANDIDATE_SQL).toContain('from cart');
      expect(ENTRANCE_PASSWORD_CART_COUNT_SQL).toContain('from cart');
      expect(ENTRANCE_PASSWORD_CART_CANDIDATE_SQL.replace(/from cart/, 'from "order"')).toBe(
        ENTRANCE_PASSWORD_CANDIDATE_SQL,
      );
      expect(ENTRANCE_PASSWORD_CART_COUNT_SQL.replace(/from cart/, 'from "order"')).toBe(ENTRANCE_PASSWORD_COUNT_SQL);
    });

    it('카트 후보 조회도 오래된 것부터 뽑고 배치 상한을 받는다', () => {
      expect(ENTRANCE_PASSWORD_CART_CANDIDATE_SQL).toContain('order by created_at asc');
      expect(ENTRANCE_PASSWORD_CART_CANDIDATE_SQL).toContain('limit ?');
    });
  });

  describe('parseEntrancePasswordPurgeArgs', () => {
    it('인자가 없으면 dry run 이다', () => {
      expect(parseEntrancePasswordPurgeArgs([])).toEqual({ dryRun: true });
    });

    it('--dry-run 을 명시해도 dry run 이다', () => {
      expect(parseEntrancePasswordPurgeArgs(['--dry-run'])).toEqual({ dryRun: true });
    });

    it('정확한 확인 토큰이 있을 때만 파괴 모드로 간다', () => {
      expect(parseEntrancePasswordPurgeArgs([`--confirm=${PURGE_ALL_CONFIRM_TOKEN}`])).toEqual({ dryRun: false });
    });

    it('맨 --confirm 이나 틀린 토큰은 거부한다', () => {
      expect(() => parseEntrancePasswordPurgeArgs(['--confirm'])).toThrow(PURGE_ALL_CONFIRM_TOKEN);
      expect(() => parseEntrancePasswordPurgeArgs(['--confirm=yes'])).toThrow(PURGE_ALL_CONFIRM_TOKEN);
    });

    it('모르는 인자는 거부한다 — 오타난 --confirm 이 조용히 dry run 이 되면 안 된다', () => {
      expect(() => parseEntrancePasswordPurgeArgs(['--confrim=purge'])).toThrow('--confrim=purge');
    });
  });

  describe('chunk', () => {
    it('마지막 조각이 짧아도 전부 담는다', () => {
      expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
      expect(chunk([], 2)).toEqual([]);
    });
  });
});
