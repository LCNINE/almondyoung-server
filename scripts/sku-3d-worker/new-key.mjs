#!/usr/bin/env node
// 홈 PC 에서 실행한다. 키는 화면·로그에 내지 않고 설정 파일에만 쓴다. 출력은 서버 DB 에 넣을 해시 INSERT 한 줄뿐이다.
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

export function newWorkerKey() {
  return randomBytes(32).toString('base64url');
}

export function hashWorkerKey(key) {
  return createHash('sha256').update(key).digest('hex');
}

export function withKey(envText, key) {
  const lines = envText.split(/\r?\n/).filter((line) => !line.startsWith('SKU3D_WORKER_KEY='));

  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  return [...lines, `SKU3D_WORKER_KEY=${key}`, ''].join('\n');
}

export function insertSql(name, keyHash) {
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(name)) {
    throw new Error('이름은 영문·숫자·._- 만, 100자 이하');
  }

  return `INSERT INTO sku_3d_workers (name, key_hash) VALUES ('${name}', '${keyHash}');`;
}

function main() {
  const { values } = parseArgs({ options: { name: { type: 'string' }, 'env-file': { type: 'string' } } });

  if (!values.name || !values['env-file']) {
    console.error('사용법: node new-key.mjs --name <hostId> --env-file <설정 파일>');
    process.exit(2);
  }

  const envFile = values['env-file'];
  const key = newWorkerKey();
  const before = existsSync(envFile) ? readFileSync(envFile, 'utf8') : '';
  const sqlLine = insertSql(values.name, hashWorkerKey(key));

  writeFileSync(envFile, withKey(before, key), { mode: 0o600 });

  if (process.platform === 'win32') {
    // 상속 권한을 끊고 지금 사용자만 읽고 쓰게 한다
    execFileSync('icacls', [envFile, '/inheritance:r', '/grant:r', `${process.env.USERNAME}:F`], {
      stdio: 'ignore',
      windowsHide: true,
    });
  }

  console.log(`키를 ${envFile} 에 저장했어요. 아래 줄을 서버 core DB 에서 실행하면 등록이 끝나요.`);
  console.log(sqlLine);
}

if (process.argv[1]?.endsWith('new-key.mjs')) {
  main();
}
