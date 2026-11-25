#!/usr/bin/env node
// 홈 PC 에서 실행한다. 키는 화면·로그에 내지 않고 설정 파일에만 쓴다. 출력은 서버 DB 에 넣을 해시 INSERT 한 줄뿐이다.
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

export function newWorkerKey() {
  return randomBytes(32).toString('base64url');
}

export function hashWorkerKey(key) {
  return createHash('sha256').update(key).digest('hex');
}

export function keyFileText(key) {
  return `SKU3D_WORKER_KEY=${key}\n`;
}

export function insertSql(name, keyHash) {
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(name)) {
    throw new Error('이름은 영문·숫자·._- 만, 100자 이하');
  }

  return `INSERT INTO sku_3d_workers (name, key_hash) VALUES ('${name}', '${keyHash}');`;
}

function main() {
  const { values } = parseArgs({ options: { name: { type: 'string' }, 'key-file': { type: 'string' } } });

  if (!values.name || !values['key-file']) {
    console.error('사용법: node new-key.mjs --name <hostId> --key-file <키 전용 파일>');
    process.exit(2);
  }

  const keyFile = values['key-file'];
  const key = newWorkerKey();
  const sqlLine = insertSql(values.name, hashWorkerKey(key));

  // 늘 새로 만든다 — 기존 파일에 남아 있던 권한을 물려받지 않게
  rmSync(keyFile, { force: true });
  writeFileSync(keyFile, keyFileText(key), { mode: 0o600, flag: 'wx' });

  if (process.platform === 'win32') {
    // 상속 권한을 끊고 지금 사용자만 남긴다. 새 파일이라 따로 붙은 권한은 없다
    execFileSync('icacls', [keyFile, '/inheritance:r', '/grant:r', `${process.env.USERNAME}:F`], {
      stdio: 'ignore',
      windowsHide: true,
    });
  }

  console.log(`키를 ${keyFile} 에 저장했어요. 아래 줄을 서버 core DB 에서 실행하면 등록이 끝나요.`);
  console.log(sqlLine);
}

if (process.argv[1]?.endsWith('new-key.mjs')) {
  main();
}
