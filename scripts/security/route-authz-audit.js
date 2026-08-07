#!/usr/bin/env node
/**
 * HTTP 라우트 인가(authorization) 전수 감사.
 *
 * 왜 AST 인가 — 정규식/줄단위 grep 은 여러 줄 데코레이터(`@ApiResponse({\n ... })`)가 끼면
 * 핸들러를 통째로 놓친다. 2026-08-07 감사에서 이걸로 무방비 쓰기를 105건으로 과소집계했다가
 * (실제 207건) 결론이 바뀔 뻔했다. 라우트 전수는 반드시 TypeScript AST 로 센다.
 *
 * 사용법:
 *   node scripts/security/route-authz-audit.js                 # 전체 앱
 *   node scripts/security/route-authz-audit.js core membership # 특정 앱
 *   node scripts/security/route-authz-audit.js --json          # 기계 판독용
 *
 * 배경/후속 작업: docs/api-authz-audit-2026-08.md
 */
const ts = require('typescript');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..');

/**
 * 앱마다 인가 관용구가 다르다. 이 맵이 틀리면 결과가 통째로 위양성이 된다 —
 * 실제로 초기 감사에서 이 맵 없이 돌려 user-service 60건 / ugc 13건을 "무력화"로 오보했다.
 *
 *   globalScope : ScopeGuard 가 APP_GUARD 로 전역 등록됨 → @RequireScopes 만으로 강제된다.
 *   adminRealm  : AdminRealmGuard 가 전역 → 표시 없는 라우트는 admin/master 필요 (기본 차단).
 *   authz       : 그 앱 고유의 인가 데코레이터 이름들.
 *   defaultDeny : 표시가 없어도 가드가 막는가 (wallet 은 API key 로 fallback).
 */
const APPS = {
  core: { globalScope: false, adminRealm: true, defaultDeny: true, authz: [] },
  notification: { globalScope: false, adminRealm: true, defaultDeny: true, authz: [] },
  'channel-adapter': { globalScope: false, adminRealm: true, defaultDeny: true, authz: [] },
  'user-service': { globalScope: true, adminRealm: false, defaultDeny: false, authz: [] },
  membership: {
    globalScope: true,
    adminRealm: false,
    defaultDeny: false,
    authz: ['MembershipAdminAuth', 'MembershipInternalAuth'],
  },
  'file-service': { globalScope: true, adminRealm: false, defaultDeny: false, authz: [] },
  'ugc-service': { globalScope: true, adminRealm: false, defaultDeny: false, authz: ['UgcInternalAuth'] },
  // WalletAuthGuard 의 마지막 분기가 requireApiKeyAuth 라 표시 없는 라우트도 API key 를 요구한다.
  wallet: { globalScope: false, adminRealm: false, defaultDeny: true, authz: ['WalletAdminAuth', 'WalletJwtAuth'] },
  search: { globalScope: false, adminRealm: false, defaultDeny: false, authz: [] },
  analytics: { globalScope: false, adminRealm: false, defaultDeny: false, authz: [] },
};

const HTTP = new Set(['Get', 'Post', 'Put', 'Patch', 'Delete', 'All', 'Head', 'Options']);
const WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const GUARD_RE = /RolesGuard|MasterRoleGuard|ApiKeyGuard|AdminGuard|JwtUserGuard/;

const decoratorsOf = (node) =>
  (ts.getDecorators(node) ?? []).map((d) => {
    const e = d.expression;
    return ts.isCallExpression(e)
      ? { name: e.expression.getText(), args: e.arguments.map((a) => a.getText()) }
      : { name: e.getText(), args: [] };
  });

const has = (ds, n) => ds.some((d) => d.name === n);
const usesGuard = (ds, re) => ds.some((d) => d.name === 'UseGuards' && d.args.some((a) => re.test(a)));

function scanApp(app, cfg) {
  let files = [];
  try {
    files = execSync(`grep -rl "@Controller" apps/${app}/src --include=*.ts | grep -v '\\.spec\\.ts' | sort`, {
      cwd: REPO,
      encoding: 'utf8',
    })
      .trim()
      .split('\n')
      .filter(Boolean);
  } catch {
    return [];
  }

  const rows = [];
  for (const file of files) {
    const src = ts.createSourceFile(
      file,
      fs.readFileSync(path.join(REPO, file), 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    const visit = (node) => {
      if (ts.isClassDeclaration(node)) {
        const cd = decoratorsOf(node);
        if (has(cd, 'Controller')) {
          const base = cd.find((d) => d.name === 'Controller')?.args[0]?.replace(/['"`]/g, '') ?? '';
          for (const m of node.members) {
            if (!ts.isMethodDeclaration(m)) continue;
            const md = decoratorsOf(m);
            const verb = md.find((d) => HTTP.has(d.name));
            if (!verb) continue;
            const all = [...cd, ...md];
            const scoped = has(all, 'RequireScopes');
            const scopeEnforced = cfg.globalScope || usesGuard(all, /\bScopeGuard\b/);
            rows.push({
              app,
              file,
              line: src.getLineAndCharacterOfPosition(m.getStart()).line + 1,
              handler: `${node.name?.getText() ?? '?'}.${m.name.getText()}`,
              verb: verb.name.toUpperCase(),
              route: '/' + [base, verb.args[0]?.replace(/['"`]/g, '') ?? ''].filter(Boolean).join('/'),
              isPublic: has(all, 'Public'),
              storeRoute: has(all, 'StoreRoute'),
              // @RequireScopes 가 있는데 ScopeGuard 가 없으면 메타데이터가 무력하다.
              // AdminRealmGuard 는 이걸 "정책 명시됨" 으로 보고 위임하므로 두 가드를 다 통과한다.
              inertScope: scoped && !scopeEnforced,
              authz: scoped
                ? 'scopes'
                : (cfg.authz.find((a) => has(all, a)) ?? (usesGuard(all, GUARD_RE) ? 'guard' : null)),
            });
          }
        }
      }
      node.forEachChild(visit);
    };
    src.forEachChild(visit);
  }
  return rows;
}

const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const targets = argv.filter((a) => !a.startsWith('--'));
const selected = targets.length ? targets : Object.keys(APPS);

const all = [];
for (const app of selected) {
  const cfg = APPS[app];
  if (!cfg) {
    console.error(`알 수 없는 앱: ${app} (APPS 맵에 추가할 것 — 관용구를 모르면 결과가 위양성이 된다)`);
    process.exitCode = 1;
    continue;
  }
  all.push(...scanApp(app, cfg).map((r) => ({ ...r, cfg })));
}

const print = (title, list) => {
  if (!list.length) return;
  console.log(`  [${title}] ${list.length}`);
  for (const r of list) {
    console.log(`     ${r.verb.padEnd(6)} ${r.route.padEnd(56)} ${r.file.replace(/^apps\/[^/]+\/src\//, '')}:${r.line}`);
  }
};

const inertTotal = all.filter((r) => r.inertScope).length;

// `--json` 은 stdout 을 통째로 JSON 으로 쓴다. 사람이 읽는 출력이 한 줄이라도 섞이면 파싱이 깨진다.
// 또 여기서 `process.exit()` 를 부르면 안 된다 — stdout 이 파이프일 때 큰 JSON 이 flush 되기 전에
// 프로세스가 죽어 출력이 잘린다(전 앱 883 라우트에서 실제로 잘렸다). node 가 알아서 끝내게 둔다.
if (asJson) {
  console.log(JSON.stringify(all.map(({ cfg, ...r }) => r), null, 2));
} else {
  printReport();
}

if (inertTotal > 0) process.exitCode = 1;

function printReport() {
  for (const app of selected) {
    const rows = all.filter((r) => r.app === app);
    if (!rows.length) continue;
    const cfg = APPS[app];
    const unmarked = rows.filter((r) => !r.isPublic && !r.storeRoute && !r.authz);

    console.log(
      `\n########## ${app} — 라우트 ${rows.length} ` +
        `(ScopeGuard전역=${cfg.globalScope} AdminRealm=${cfg.adminRealm} 기본차단=${cfg.defaultDeny}) ##########`,
    );

    print(
      'A: @RequireScopes 무력화 — ScopeGuard 미바인딩 (0 이어야 함)',
      rows.filter((r) => r.inertScope),
    );

    if (cfg.defaultDeny) {
      // 기본 차단 앱에서 표시 없는 라우트는 정상(=직원/API key 전용). 셀프서비스만 따로 본다.
      print(
        'B: @StoreRoute (고객 — IDOR 검사 대상)',
        rows.filter((r) => r.storeRoute),
      );
    } else {
      print('B: 인가 표시 없음 — 인증만 통과 (IDOR 검사 대상)', unmarked);
    }
    print(
      'C: @Public 쓰기 (키/서명 검증이 있는지 반드시 확인)',
      rows.filter((r) => r.isPublic && WRITE.has(r.verb)),
    );
  }

  console.log(`\n총 라우트 ${all.length} / [A] 무력화 ${inertTotal}`);
  if (inertTotal > 0) {
    console.log('⚠ [A] 가 0 이 아니다 — 스코프도 역할도 검사하지 않는 라우트가 있다는 뜻이다.');
  }
}
