import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findPermission } from '@app/authorization';

/**
 * 모든 라우트는 공개·고객·키·권한 중 «정확히 하나»로 분류된다(ADR-0048). 분류 없는 라우트는
 * 권한 판정이 강제되는 순간 403 이 되므로, 새 라우트를 만들 때 여기서 먼저 걸린다.
 */
const AUDIT = join(__dirname, 'route-authz-audit.js');

interface AuditRow {
  app: string;
  verb: string;
  route: string;
  file: string;
  line: number;
  classifications: string[];
  permissions: string[];
  permissionDecorators: number;
}

const rows: AuditRow[] = JSON.parse(
  execFileSync('node', [AUDIT, '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }),
);
const where = (r: AuditRow) => `${r.app} ${r.verb} ${r.route} (${r.file}:${r.line})`;
const keyOf = (r: AuditRow) => `${r.app} ${r.verb} ${r.route}`;
const isRead = (verb: string) => verb === 'GET' || verb === 'HEAD';
const actionOf = (permission: string) => permission.split('.')[2];

/** 쓰기 동사지만 조회 권한으로 충분한 라우트. 값은 «무엇을 바꾸지 않는가». */
const READ_VIA_WRITE_VERB: Record<string, string> = {
  'core POST /archive/pages/:id/favorite': '내 즐겨찾기만 바뀐다 — 문서는 그대로다',
  'core DELETE /archive/pages/:id/favorite': '내 즐겨찾기만 바뀐다 — 문서는 그대로다',
  'core POST /masters/:masterId/pricing/calculate': '가격을 계산해 돌려줄 뿐 저장하지 않는다',
  'core POST /versions/:versionId/pricing/calculate': '가격을 계산해 돌려줄 뿐 저장하지 않는다',
  'core POST /matchings/variants/:variantId/sku-lookup': '본문 조건으로 조회한다',
  'core POST /matchings/variants/batch': '여러 변형을 한 번에 조회한다',
  'notification POST /alimtalk/auto-sends/membership-notices/lookup': '대상을 조회만 한다',
  'notification POST /alimtalk/campaigns/preview': '미리보기 — 발송하지 않는다',
  'notification POST /sms-gate/campaigns/preview': '미리보기 — 발송하지 않는다',
  'notification POST /templates/preview/:id': '미리보기 — 발송하지 않는다',
  'user-service POST /consents/search': '본문 조건으로 조회한다',
  'user-service POST /admin/iam/pii-access-reviews': '접속기록 점검 표시만 남긴다 — 개인정보·권한은 바뀌지 않는다',
  'user-service POST /iam/pii-access-logs': '열람한 사실을 기록할 뿐 — 개인정보·권한은 바뀌지 않는다',
  'membership POST /admin/subscriptions/bulk': '여러 회원을 한 번에 조회한다',
};

/** 조회 동사지만 조회 아닌 권한을 요구하는 라우트. 값은 이유. */
const NON_READ_GET: Record<string, string> = {
  'core GET /direct-ship/export/:companyName': '내보내기다',
  'core GET /shipment-recall-operations/:operationId': '회수 작업 상태 — 회수 권한자의 작업 화면',
  'user-service GET //admin/oauth-clients': '시스템 설정 화면 전체가 관리 권한 하나다',
  'user-service GET //admin/oauth-clients/:clientId': '시스템 설정 화면 전체가 관리 권한 하나다',
  'ai GET /assistant/sessions': '어시스턴트 사용자 자신의 대화 목록이다',
  'ai GET /assistant/sessions/:sessionId/messages': '어시스턴트 사용자 자신의 대화다',
};

describe('라우트 분류', () => {
  it('모든 라우트가 공개·고객·키·권한 중 정확히 하나로 분류된다', () => {
    const offenders = rows
      .filter((r) => r.classifications.length !== 1)
      .map((r) => `${where(r)} [${r.classifications.join('+') || '없음'}]`);
    expect(offenders).toEqual([]);
  });

  it('권한 선언은 라우트마다 한 번이다(클래스와 메서드에 겹치지 않는다)', () => {
    expect(rows.filter((r) => r.permissionDecorators > 1).map(where)).toEqual([]);
  });

  it('선언한 권한은 권한 목록에 있다', () => {
    const unknown = rows.flatMap((r) => r.permissions.filter((p) => !findPermission(p)).map((p) => `${where(r)} ${p}`));
    expect(unknown).toEqual([]);
  });

  it('시스템 전용 권한은 다른 권한과 섞어 «하나라도»로 열지 않는다', () => {
    const mixed = rows.filter(
      (r) => r.permissions.length > 1 && r.permissions.some((p) => findPermission(p)?.systemOnly),
    );
    expect(mixed.map(where)).toEqual([]);
  });

  it('조회 동사는 조회 권한을 요구한다 — 예외는 이유와 함께', () => {
    const offenders = rows
      .filter((r) => isRead(r.verb) && r.permissions.some((p) => actionOf(p) !== 'read'))
      .filter((r) => !(keyOf(r) in NON_READ_GET))
      .map(where);
    expect(offenders).toEqual([]);
  });

  it('쓰기 동사는 조회 권한만으로 열리지 않는다 — 예외는 이유와 함께', () => {
    const offenders = rows
      .filter((r) => !isRead(r.verb) && r.permissions.length > 0 && r.permissions.every((p) => actionOf(p) === 'read'))
      .filter((r) => !(keyOf(r) in READ_VIA_WRITE_VERB))
      .map(where);
    expect(offenders).toEqual([]);
  });

  it('키 인증 표식은 JwtAuthGuard 가 전역이 아닌 wallet 에서만 쓴다', () => {
    expect(rows.filter((r) => r.classifications.includes('key') && r.app !== 'wallet').map(where)).toEqual([]);
  });

  it('예외 목록은 실제 라우트를 가리킨다', () => {
    const live = new Set(rows.map(keyOf));
    const stale = [...Object.keys(READ_VIA_WRITE_VERB), ...Object.keys(NON_READ_GET)].filter((k) => !live.has(k));
    expect(stale).toEqual([]);
  });
});

describe('감사 스크립트의 공개 판정', () => {
  // 런타임 해석기는 isPublic 이 «true» 일 때만 공개로 본다. 감사도 같은 값을 봐야 게이트가 실제 판정과 맞는다.
  it('SetMetadata 로 isPublic 을 false 로 둔 라우트는 공개로 세지 않는다', () => {
    const root = mkdtempSync(join(tmpdir(), 'route-audit-'));
    try {
      mkdirSync(join(root, 'apps/core/src'), { recursive: true });
      symlinkSync(join(__dirname, '..', '..', 'node_modules'), join(root, 'node_modules'));
      writeFileSync(
        join(root, 'apps/core/src/probe.controller.ts'),
        [
          "import { Controller, Get, SetMetadata } from '@nestjs/common';",
          "@Controller('probe')",
          'export class ProbeController {',
          "  @SetMetadata('isPublic', false)",
          '  @Get()',
          '  closed() {}',
          "  @SetMetadata('isPublic', true)",
          "  @Get('open')",
          '  open() {}',
          '}',
        ].join('\n'),
      );
      const probe: AuditRow[] = JSON.parse(
        execFileSync('node', [AUDIT, '--json', 'core'], {
          encoding: 'utf8',
          env: { ...process.env, ROUTE_AUDIT_ROOT: root },
        }),
      );
      expect(probe.map((r) => [r.route, r.classifications])).toEqual([
        ['/probe', []],
        ['/probe/open', ['public']],
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
