import * as ExcelJS from 'exceljs';
import { TokenRefused } from '../staff-token';
import { expectOk, probe, waitFor } from './http';
import { fail, messageOf, onlyOwnRows, pass, Probe, refusedByTenantGate, skip, tokenTenantOf, Verdict } from './judge';
import type { IsolationCheck } from './runner';
import { buildScreenChecks } from './screens';
import { SHARED_SERVICE_PROBES, type ConsumerMetrics, type IsolationTarget } from './target';

/**
 * 문들이 거절할 때 내는 문구. 상태만 보면 권한 거절과 구별되지 않는다(`judge.refusedByTenantGate`).
 * 출처가 바뀌면 `gate-messages.spec.ts` 가 빨갛다.
 */
export const GATE_MESSAGES = {
  /** libs/authorization/src/services/served-tenant-gate.ts — 공유 서비스 일곱 개 */
  servedTenant: '이 테넌트에서는 쓸 수 없는 기능입니다.',
  /** apps/admin-web/src/lib/auth/server-credential-tenant.server.ts — Medusa 프록시·channel-dispatch */
  serverCredential: 'Not available for this tenant',
  /** apps/file-service/src/access/file-access.ts — 파일 테넌트 ≠ 요청 테넌트면 직원 예외가 안 열린다 */
  fileAccess: 'You do not have permission to access this file',
  /** apps/core/src/platform/tenancy/core-request-tenant.interceptor.ts — 정지 스위치 */
  coreSuspended: '이용이 정지된 테넌트입니다.',
} as const;

const FIXED_BY = {
  serverCredential:
    '비공개 지도 10 — admin-web 서버 자격증명 라우트의 테넌트 판정(apps/admin-web/src/lib/auth/server-credential-tenant.server.ts). ' +
    '로컬은 admin-web .env.local 의 SERVER_CREDENTIAL_TENANT_ID·TENANT_GATE_MODE → npm run bootstrap:e2e:local',
  servedTenant:
    '비공개 지도 09 — 공유 서비스 문(libs/authorization/src/services/served-tenant-gate.ts, 앱의 PermissionModule.forRoot «served-tenant»). ' +
    '로컬은 그 앱 .env 의 SERVED_TENANT_ID → npm run bootstrap:e2e:local',
  fileTenant:
    '비공개 지도 14 — file-service 파일 테넌트 대조(apps/file-service/src/access/file-access.ts 의 fileBelongsTo)',
  coreRouting:
    '비공개 지도 12 — core 요청 맥락의 DB 선택(apps/core/src/platform/tenancy). 로컬은 core 를 ② 로: E2E_GATE_MODE=reject npm run start:all:local',
  cron: '비공개 지도 13 — 크론의 테넌트별 선점(@app/cron-once, 테넌트 목록 순회). 목록에 테넌트 2 가 없으면 npm run tenant:create:local',
  events:
    '비공개 지도 08 — 소비 앱 핸들러 앞의 문(libs/events/src/tenancy/event-tenant-gate.ts)과 07 의 봉투 테넌트 찍기',
  suspend: '비공개 지도 16 — 정지 스위치(user-service 발급 거절 + core TenantStatusCache, 15초 주기)',
  tenantOne: '전환 배포 회귀 — 테넌트 1 이 지금 그대로 일해야 한다. 각 앱 로그부터 본다(로컬: logs/<앱>.log)',
} as const;

/** user-service 가 준비·정지 테넌트로 발급·갱신을 거절할 때의 문구(apps/user-service/src/api/oauth/oauth.manager.ts). */
export const TENANT_NOT_ISSUABLE = 'tenant not active';
const STAMP_PREFIX = '[개통 점검]';

/** 두 번 다 읽힌 앱 중 값이 오른 앱. 한 번만 읽힌 앱은 비교하지 않는다(합으로 비교하면 거짓 증감이 난다). */
function risen(before: Readonly<Record<string, number>>, after: Readonly<Record<string, number>>): string[] {
  return Object.keys(after).filter((app) => app in before && after[app] > before[app]);
}
const EVENT_WAIT_MS = 90_000;
const SUSPEND_WAIT_MS = 45_000;

/** 목록 응답(배열 또는 `{ data }`)의 행 id. 상품 요약은 `masterId` 가 행의 id 다. */
function idsOf(body: unknown, key: 'id' | 'masterId' = 'id'): string[] {
  const rows: unknown = Array.isArray(body) ? body : (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(rows)) throw new Error(`목록 모양이 아니다: ${JSON.stringify(body).slice(0, 120)}`);
  return rows.map((r: Record<string, unknown>) => {
    const id = r[key];
    if (typeof id !== 'string') throw new Error(`목록 행에 ${key} 가 없다: ${JSON.stringify(r).slice(0, 120)}`);
    return id;
  });
}

function isOk(p: Probe): boolean {
  return p.status >= 200 && p.status < 300;
}

/** 테넌트 1 대조 호출이 2xx 여야 거절 판정이 의미 있다(경로가 썩었거나 서비스가 아프면 403 도 404 도 아무것도 증명 못 한다). */
function control(p: Probe): Verdict | null {
  return isOk(p)
    ? null
    : fail(`대조(테넌트 1 토큰)가 ${p.status} «${messageOf(p.body)}» — 경로가 틀렸거나 서비스가 아프다`);
}

/** 테넌트 2 가 만든 것을 테넌트 1 토큰으로 열면 404 여야 한다(다른 DB). */
function hiddenFromTenantOne(p: Probe, what: string): Verdict {
  if (p.status === 404) return pass;
  if (isOk(p)) return fail(`테넌트 1 토큰으로 ${what} 이(가) 열렸다 — 같은 DB 를 본다`);
  return fail(`테넌트 1 토큰으로 ${what} 을(를) 열자 ${p.status} «${messageOf(p.body)}» — 404 가 아니다`);
}

interface WriteState {
  stamp: string;
  baseline?: { metrics: ConsumerMetrics; medusaCount: number };
  warehouseId?: string;
  skuId?: string;
  masterIds: string[];
  bulkSessionId?: string;
  suspended: boolean;
}

/**
 * 격리 실측의 항목 전부. 순서가 곧 출력 순서다. 쓰기 부분은 앞 항목이 만든 것을 뒤 항목이 본다(`WriteState`).
 * 정지 스위치는 맨 뒤 — 정지 중에는 다른 점검이 거절된다.
 */
export function buildIsolationChecks(t: IsolationTarget): {
  checks: IsolationCheck<void>[];
  /** 정지를 건 채로 끊겼으면(Ctrl+C) 활성으로 되돌린다 — 진입점이 신호 처리에서 부른다 */
  restoreIfSuspended: () => Promise<void>;
  /** 화면 실측의 브라우저를 닫는다 — 진입점이 끝에 부른다 */
  closeBrowser: () => Promise<void>;
} {
  const tokens: { one?: string; two?: string } = {};
  const one = async () => (tokens.one ??= await t.signIn.tenantOne());
  const two = async () => (tokens.two ??= await t.signIn.tenantTwo());
  const core = (path: string) => `${t.urls.core}${path}`;
  const medusaProxy = (path: string) => `${t.urls.adminWeb}/api/proxy/medusa${path}`;

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const state: WriteState = {
    stamp: `${STAMP_PREFIX} ${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`,
    masterIds: [],
    suspended: false,
  };

  const medusaProductCount = async (q?: string) => {
    const body = (await expectOk(
      'GET',
      medusaProxy(`/admin/products?limit=1&fields=id${q ? `&q=${encodeURIComponent(q)}` : ''}`),
      {
        cookieToken: await one(),
      },
    )) as { count: number };
    return body.count;
  };

  const checks: IsolationCheck<void>[] = [];
  const add = (c: IsolationCheck<void>) => checks.push(c);

  // ── 로그인 — 뒤의 모든 항목이 이 토큰을 쓴다
  add({
    section: '점검 계정',
    title: '테넌트 2 점검 계정 토큰의 테넌트가 2 다',
    part: 'read',
    fixedBy: '비공개 지도 05 — 등록 리디렉트 host → 테넌트. 로컬 점검 계정은 npm run tenant:create:local',
    run: async () => {
      const tenant = tokenTenantOf(await two());
      return tenant === t.tenantTwoId ? pass : fail(`토큰 테넌트가 ${tenant ?? '없음'}`);
    },
  });
  add({
    section: '점검 계정',
    title: '테넌트 1 점검 계정 토큰의 테넌트가 1 이다',
    part: 'read',
    fixedBy: '비공개 지도 05 — 등록 리디렉트 host → 테넌트',
    run: async () => {
      const tenant = tokenTenantOf(await one());
      return tenant === t.tenantOneId ? pass : fail(`토큰 테넌트가 ${tenant ?? '없음'}`);
    },
  });

  // ── 직접 호출: 테넌트 2 토큰이 테넌트 1 만 섬기는 업스트림을 못 연다
  for (const [title, path] of [
    ['Medusa 프록시 상품 — 테넌트 2 는 403', '/admin/products?limit=1&fields=id'],
    ['Medusa 프록시 주문 — 테넌트 2 는 403', '/admin/orders?limit=1&fields=id'],
  ] as const) {
    add({
      section: '직접 호출',
      title,
      part: 'read',
      fixedBy: FIXED_BY.serverCredential,
      run: async () => {
        const c = control(await probe('GET', medusaProxy(path), { cookieToken: await one() }));
        if (c) return c;
        return refusedByTenantGate(
          await probe('GET', medusaProxy(path), { cookieToken: await two() }),
          GATE_MESSAGES.serverCredential,
        );
      },
    });
  }
  for (const svc of t.sharedServices) {
    const path = SHARED_SERVICE_PROBES[svc.name];
    add({
      section: '직접 호출',
      title: `${svc.name} ${path} — 테넌트 2 는 403`,
      part: 'read',
      fixedBy: FIXED_BY.servedTenant,
      run: async () => {
        if (!svc.url) return skip(`${svc.name} 이(가) 이 대상에 없다`);
        const c = control(await probe('GET', `${svc.url}${path}`, { bearer: await one() }));
        if (c) return c;
        return refusedByTenantGate(
          await probe('GET', `${svc.url}${path}`, { bearer: await two() }),
          GATE_MESSAGES.servedTenant,
        );
      },
    });
  }
  add({
    section: '직접 호출',
    title: '테넌트 1 디지털 상품 파일 — 테넌트 2 는 403',
    part: 'read',
    fixedBy: FIXED_BY.fileTenant,
    run: async () => {
      const fileId = await t.tenantOneDigitalFileId();
      if (!fileId) return skip('테넌트 1 디지털 상품 파일이 없다 (로컬: --write 가 하나 올린다)');
      const url = `${t.urls.fileService}/files/${fileId}/metadata`;
      const c = control(await probe('GET', url, { bearer: await one() }));
      if (c) return c;
      return refusedByTenantGate(await probe('GET', url, { bearer: await two() }), GATE_MESSAGES.fileAccess);
    },
  });

  // ── core 목록: 테넌트 2 토큰에는 테넌트 2 행만
  // /masters 는 page 가 없으면 limit 을 무시하고 전부 준다 — 테넌트 1 토큰으로 그렇게 부르면 core 가 OOM 으로 죽는다(11-02 라이브).
  for (const [what, path, key] of [
    ['창고', '/inventory/warehouses', 'id'],
    ['상품', '/masters?mode=all&page=1&limit=100', 'masterId'],
    ['SKU', '/inventory/skus?limit=100', 'id'],
  ] as const) {
    add({
      section: 'core 목록',
      title: `${what} 목록 — 테넌트 2 토큰에 테넌트 1 행이 없다`,
      part: 'read',
      fixedBy: FIXED_BY.coreRouting,
      run: async () =>
        onlyOwnRows({
          tenantOne: idsOf(await expectOk('GET', core(path), { bearer: await one() }), key),
          tenantTwo: idsOf(await expectOk('GET', core(path), { bearer: await two() }), key),
        }),
    });
  }

  // ── 크론
  add({
    section: '크론',
    title: '테넌트 1 에서 도는 크론이 테넌트 2 core DB 에도 선점 행을 남긴다(주기당 1행은 PK 가 보장)',
    part: 'read',
    fixedBy: FIXED_BY.cron,
    run: async () => {
      const r = await t.tenantTwoCronRuns();
      if (r.tenantOneRecent === 0)
        return fail(`테넌트 1 에서도 최근 ${r.windowMinutes}분 동안 돈 크론이 없다 — 대조할 수 없다`);
      if (r.missingInTenantTwo.length > 0) {
        return fail(
          `테넌트 2 에서 안 도는 크론 ${r.missingInTenantTwo.length}개: ${r.missingInTenantTwo.slice(0, 5).join(', ')}`,
        );
      }
      return pass;
    },
  });

  // ── 테넌트 1 스모크
  add({
    section: '테넌트 1 스모크',
    title: '아몬드영 관리자 — admin-web 으로 창고 목록이 나온다',
    part: 'read',
    fixedBy: FIXED_BY.tenantOne,
    run: async () => {
      const ids = idsOf(
        await expectOk('GET', `${t.urls.adminWeb}/api/proxy/api/inventory/warehouses`, { cookieToken: await one() }),
      );
      return ids.length > 0 ? pass : fail('창고 0행');
    },
  });
  add({
    section: '테넌트 1 스모크',
    title: '아몬드영 관리자 — Medusa 상품 목록이 나온다',
    part: 'read',
    fixedBy: FIXED_BY.tenantOne,
    run: async () => ((await medusaProductCount()) > 0 ? pass : fail('Medusa 상품 0개')),
  });
  add({
    section: '테넌트 1 스모크',
    title: '쇼핑몰 로그인 — 테넌트 1 고객 토큰이 나온다',
    part: 'read',
    fixedBy: FIXED_BY.tenantOne,
    run: async () => {
      const tenant = tokenTenantOf(await t.customerToken());
      return tenant === t.tenantOneId ? pass : fail(`쇼핑몰 토큰의 테넌트가 ${tenant ?? '없음'}`);
    },
  });
  add({
    section: '테넌트 1 스모크',
    title: '쇼핑몰 상품 조회 — 스토어 API 에 상품이 있다',
    part: 'read',
    fixedBy: FIXED_BY.tenantOne,
    run: async () => {
      const body = (await expectOk('GET', `${t.urls.medusa}/store/products?limit=1&fields=id`, {
        headers: { 'x-publishable-api-key': t.storePublishableKey },
      })) as { count: number };
      return body.count > 0 ? pass : fail('스토어 상품 0개');
    },
  });

  // ── 쓰기 경로 (개통 때 한 번)
  const write = t.write;
  const needsWrite = (): Verdict | null => (write ? null : fail(`${t.label} 대상은 쓰기 부분을 아직 못 돈다`));
  add({
    section: '쓰기 경로',
    title: '기준값 — 소비 앱 건너뜀·DLQ 수, 아몬드영 Medusa 상품 수',
    part: 'write',
    fixedBy: '대상의 메트릭 주소 — 로컬은 앱 포트 + 10000',
    run: async () => {
      const missing = needsWrite();
      if (missing || !write) return missing ?? fail('쓰기 대상 없음');
      state.baseline = { metrics: await write.consumerMetrics(), medusaCount: await medusaProductCount() };
      return pass;
    },
  });
  add({
    section: '쓰기 경로',
    title: '창고 만들기 — 테넌트 2 목록에 있고 테넌트 1 은 못 연다',
    part: 'write',
    fixedBy: FIXED_BY.coreRouting,
    run: async () => {
      const made = (await expectOk('POST', core('/inventory/warehouses'), {
        bearer: await two(),
        json: { name: `${state.stamp} 창고` },
      })) as { id: string };
      state.warehouseId = made.id;
      const listed = idsOf(await expectOk('GET', core('/inventory/warehouses'), { bearer: await two() }));
      if (!listed.includes(made.id)) return fail('만든 창고가 테넌트 2 목록에 없다');
      return hiddenFromTenantOne(
        await probe('GET', core(`/inventory/warehouses/${made.id}`), { bearer: await one() }),
        '창고',
      );
    },
  });
  add({
    section: '쓰기 경로',
    title: '로케이션 만들기 — 테넌트 2 창고에 구역이 생긴다',
    part: 'write',
    fixedBy: FIXED_BY.coreRouting,
    run: async () => {
      if (!state.warehouseId) return fail('창고를 못 만들어 건너뛴다');
      const r = await probe('POST', core(`/locations/warehouses/${state.warehouseId}/zones`), {
        bearer: await two(),
        json: { code: `ISOCHECK${Date.now() % 100000}`, displayName: `${state.stamp} 구역` },
      });
      return isOk(r) ? pass : fail(`${r.status} «${messageOf(r.body)}»`);
    },
  });
  add({
    section: '쓰기 경로',
    title: 'SKU 만들기 — 테넌트 1 은 못 연다',
    part: 'write',
    fixedBy: FIXED_BY.coreRouting,
    run: async () => {
      const made = (await expectOk('POST', core('/inventory/skus'), {
        bearer: await two(),
        // 사입(physical) SKU 는 배송 프로필이 필요한데 배송 프로필엔 지우기 경로가 없다 — 직원 입력 전 DB 에 남지 않게 무제한으로 만든다.
        json: { name: `${state.stamp} SKU`, stockType: 'infinite' },
      })) as { id: string };
      state.skuId = made.id;
      return hiddenFromTenantOne(
        await probe('GET', core(`/inventory/skus/${made.id}`), { bearer: await one() }),
        'SKU',
      );
    },
  });
  add({
    section: '쓰기 경로',
    title: '상품 게시 — 테넌트 1 은 못 연다',
    part: 'write',
    fixedBy: FIXED_BY.coreRouting,
    run: async () => {
      const made = (await expectOk('POST', core('/masters'), { bearer: await two() })) as {
        id: string;
        masterId: string;
      };
      state.masterIds.push(made.masterId);
      await expectOk('PUT', core(`/masters/${made.masterId}/versions/${made.id}`), {
        bearer: await two(),
        json: { name: `${state.stamp} 상품` },
      });
      await expectOk('PATCH', core(`/masters/${made.masterId}/versions/${made.id}/publish`), {
        bearer: await two(),
        json: {},
      });
      return hiddenFromTenantOne(
        await probe('GET', core(`/masters/${made.masterId}`), { bearer: await one() }),
        '상품',
      );
    },
  });
  add({
    section: '쓰기 경로',
    title: '일괄 세션 — 양식 한 행을 게시까지, 테넌트 1 은 세션을 못 연다',
    part: 'write',
    fixedBy: FIXED_BY.coreRouting,
    run: async () => {
      const blank = await fetch(core('/product-forms/blank'), { headers: { authorization: `Bearer ${await two()}` } });
      if (!blank.ok) return fail(`빈 양식 ${blank.status}`);
      const form = new FormData();
      form.append('name', `${state.stamp} 일괄`);
      form.append(
        'file',
        new Blob([
          new Uint8Array(await oneRowWorkbook(Buffer.from(await blank.arrayBuffer()), `${state.stamp} 일괄 상품`)),
        ]),
        'isolation-check.xlsx',
      );
      const accepted = (await expectOk('POST', core('/product-bulk-sessions'), { bearer: await two(), form })) as {
        sessionId: string;
      };
      state.bulkSessionId = accepted.sessionId;
      const session = core(`/product-bulk-sessions/${accepted.sessionId}`);
      const phaseOf = async () =>
        (await expectOk('GET', session, { bearer: await two() })) as { phase: string; phaseError: string | null };
      const settle = async (want: string) => {
        const s = await waitFor(
          phaseOf,
          (v) => v.phase === want || v.phase === 'failed' || v.phase === 'canceled',
          120_000,
        );
        if (s.phase !== want)
          throw new Error(`세션이 ${want} 대신 ${s.phase}${s.phaseError ? ` «${s.phaseError}»` : ''}`);
      };
      await settle('review');
      await expectOk('POST', `${session}/approve`, { bearer: await two(), json: {} });
      await settle('drafted');
      await expectOk('POST', `${session}/publish`, { bearer: await two(), json: {} });
      await settle('published');
      const items = (await expectOk('GET', `${session}/items?limit=100`, { bearer: await two() })) as {
        data: { masterId?: string | null }[];
      };
      for (const item of items.data) if (item.masterId) state.masterIds.push(item.masterId);
      return hiddenFromTenantOne(await probe('GET', session, { bearer: await one() }), '일괄 세션');
    },
  });
  add({
    section: '쓰기 경로',
    title: '소비 앱이 테넌트 2 이벤트를 건너뛴다(건너뜀 수가 오른다)',
    part: 'write',
    fixedBy: FIXED_BY.events,
    run: async () => {
      if (!write || !state.baseline) return fail('기준값이 없다');
      const before = state.baseline.metrics.skippedOtherTenant;
      const after = await waitFor(
        write.consumerMetrics,
        (m) => risen(before, m.skippedOtherTenant).length > 0,
        EVENT_WAIT_MS,
      );
      const rose = risen(before, after.skippedOtherTenant);
      if (rose.length === 0) {
        return fail(
          `${EVENT_WAIT_MS / 1000}초 동안 어느 소비 앱도 건너뛰지 않았다 — 이벤트가 안 나갔거나 문이 통과시켰다`,
        );
      }
      // 문이 통과시킨 앱은 여기선 안 보인다(다른 앱이 건너뛰어 초록) — 아래 DLQ·Medusa 항목이 그 앱의 흔적을 본다.
      return after.unreachable.length > 0
        ? skip(`건너뛴 앱: ${rose.join(', ')}. 메트릭을 못 읽은 앱: ${after.unreachable.join(', ')}`)
        : pass;
    },
  });
  add({
    section: '쓰기 경로',
    title: 'DLQ 로 간 메시지 0',
    part: 'write',
    fixedBy: `${FIXED_BY.events}. 어느 토픽인지는 각 앱 /metrics 의 events_dlq_messages_total`,
    run: async () => {
      if (!write || !state.baseline) return fail('기준값이 없다');
      const rose = risen(state.baseline.metrics.deadLettered, (await write.consumerMetrics()).deadLettered);
      return rose.length === 0 ? pass : fail(`DLQ 가 오른 앱: ${rose.join(', ')}`);
    },
  });
  add({
    section: '쓰기 경로',
    title: '아몬드영 Medusa 에 새 상품 0',
    part: 'write',
    fixedBy: `${FIXED_BY.events} — channel-adapter 가 테넌트 2 상품을 Medusa 로 보냈다`,
    run: async () => {
      if (!state.baseline) return fail('기준값이 없다');
      const stamped = await medusaProductCount(STAMP_PREFIX);
      if (stamped > 0) return fail(`«${STAMP_PREFIX}» 상품 ${stamped}개가 아몬드영 Medusa 에 있다`);
      const delta = (await medusaProductCount()) - state.baseline.medusaCount;
      return delta === 0 ? pass : fail(`Medusa 상품 수가 ${delta} 바뀌었다 — 그 사이 다른 사람이 만들었는지 확인`);
    },
  });
  // ── 화면·주소 교차 (읽기 전용) — 쓰기 부분이 만든 상품·일괄 세션이 지워지기 전에 돈다(동적 화면이 그 행으로 열린다)
  const screens = buildScreenChecks(t, two);
  checks.push(...screens.checks);

  add({
    section: '쓰기 경로',
    title: `지우기 — «${STAMP_PREFIX}» 로 만든 것`,
    part: 'write',
    fixedBy: '남은 것은 출력의 id 로 지운다',
    run: async () => {
      const left: string[] = [];
      if (state.bulkSessionId) {
        await probe('POST', core(`/product-bulk-sessions/${state.bulkSessionId}/purge-drafts`), {
          bearer: await two(),
          json: {},
        });
      }
      for (const id of state.masterIds) {
        await probe('PATCH', core(`/masters/${id}/unpublish`), { bearer: await two(), json: {} });
      }
      if (state.masterIds.length > 0) {
        if (write?.removeProducts) await write.removeProducts(state.masterIds);
        else left.push(`상품 ${state.masterIds.join(', ')} (게시 내림만 — 역할에 catalog.product.delete 가 없다)`);
      }
      if (state.skuId) {
        const r = await probe('DELETE', core(`/inventory/skus/${state.skuId}`), { bearer: await two() });
        if (!isOk(r)) left.push(`SKU ${state.skuId} (${r.status} «${messageOf(r.body)}»)`);
      }
      if (state.warehouseId) {
        const r = await probe('DELETE', core(`/inventory/warehouses/${state.warehouseId}`), { bearer: await two() });
        if (!isOk(r)) left.push(`창고 ${state.warehouseId} (${r.status} «${messageOf(r.body)}»)`);
      }
      return left.length === 0 ? pass : skip(`남은 것: ${left.join(' · ')}`);
    },
  });

  // ── 정지 스위치 (개통 때 한 번 — 정지하면 그 테넌트 세션이 끊긴다)
  add({
    section: '정지 스위치',
    title: '정지 → 테넌트 2 로그인(발급)이 거절된다',
    part: 'write',
    fixedBy: FIXED_BY.suspend,
    run: async () => {
      if (!write) return fail('쓰기 대상 없음');
      await two(); // 정지 전에 받아 둔 토큰 — 다음 항목이 core 에서 거절되는지 본다
      await write.setTenantStatus(t.tenantTwoId, 'suspended');
      state.suspended = true;
      try {
        await t.signIn.tenantTwo();
        return fail('정지 중인데 토큰이 나왔다');
      } catch (e) {
        if (!(e instanceof TokenRefused)) throw e;
        // 로그인 실패·5xx 도 TokenRefused 다 — 발급 단계에서 «테넌트가 활성이 아니다»로 거절됐는지까지 본다.
        const issuing = e.stage === 'issue-code' || e.stage === 'token';
        return issuing && e.message.includes(TENANT_NOT_ISSUABLE)
          ? pass
          : fail(`정지가 아닌 이유로 거절됐다: ${e.message}`);
      }
    },
  });
  add({
    section: '정지 스위치',
    title: `정지 → core 가 남은 액세스 토큰을 거절한다(${SUSPEND_WAIT_MS / 1000}초 안)`,
    part: 'write',
    fixedBy: FIXED_BY.suspend,
    run: async () => {
      if (!state.suspended) return fail('정지를 못 걸었다');
      const token = await two();
      const r = await waitFor(
        () => probe('GET', core('/inventory/warehouses'), { bearer: token }),
        (p) => p.status === 403,
        SUSPEND_WAIT_MS,
      );
      return refusedByTenantGate(r, GATE_MESSAGES.coreSuspended);
    },
  });
  add({
    section: '정지 스위치',
    title: `활성 복귀 → 로그인이 되고 core 가 다시 받는다(${SUSPEND_WAIT_MS / 1000}초 안)`,
    part: 'write',
    fixedBy: FIXED_BY.suspend,
    run: async () => {
      if (!write) return fail('쓰기 대상 없음');
      // 앞 항목이 실패했어도 언제나 되돌린다 — 정지인 채로 끝나면 직원이 못 들어온다.
      await write.setTenantStatus(t.tenantTwoId, 'active');
      state.suspended = false;
      const fresh = await t.signIn.tenantTwo();
      const r = await waitFor(
        () => probe('GET', core('/inventory/warehouses'), { bearer: fresh }),
        isOk,
        SUSPEND_WAIT_MS,
      );
      return isOk(r) ? pass : fail(`복귀 뒤에도 ${r.status} «${messageOf(r.body)}»`);
    },
  });

  return {
    checks,
    restoreIfSuspended: async () => {
      if (state.suspended && write) await write.setTenantStatus(t.tenantTwoId, 'active');
    },
    closeBrowser: screens.close,
  };
}

/** 빈 양식의 «상품» 시트에 한 행(상품키·상품명·판매가)을 채운다. 열은 머리글 이름으로 찾는다. */
async function oneRowWorkbook(blank: Buffer, name: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  // exceljs 의 load 타입은 ArrayBuffer 지만 Node Buffer 를 받는다(core 양식 파서 bulk-upload.parser.ts 도 exceljs 타입을 캐스트로 맞춘다).
  await wb.xlsx.load(blank as unknown as ArrayBuffer);
  const sheet = wb.getWorksheet('상품');
  if (!sheet) throw new Error('빈 양식에 «상품» 시트가 없다');
  const header = sheet.getRow(1);
  const col = (label: string) => {
    let found = 0;
    header.eachCell((cell, n) => {
      if (typeof cell.value === 'string' && cell.value.trim() === label) found = n;
    });
    if (!found) throw new Error(`«상품» 시트에 «${label}» 열이 없다`);
    return found;
  };
  const row = sheet.getRow(2);
  row.getCell(col('상품키')).value = 'ISOCHECK-1';
  row.getCell(col('상품명')).value = name;
  row.getCell(col('판매가')).value = '1000';
  row.commit();
  return Buffer.from(await wb.xlsx.writeBuffer());
}
