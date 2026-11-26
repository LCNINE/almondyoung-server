import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashWorkerKey, insertSql, newWorkerKey } from './new-key.mjs';

test('key is long and random', () => {
  const a = newWorkerKey();

  assert.ok(a.length >= 43);
  assert.notEqual(a, newWorkerKey());
});

test('cli writes the key only to a fresh owner-only file and prints only the hash', () => {
  const keyFile = join(mkdtempSync(join(tmpdir(), 'sku3d-key-')), 'worker-key.env');
  const out = execFileSync(process.execPath, [join(import.meta.dirname, 'new-key.mjs'), '--name', 'host-1', '--key-file', keyFile], {
    encoding: 'utf8',
  });
  const key = readFileSync(keyFile, 'utf8').trim().replace('SKU3D_WORKER_KEY=', '');

  assert.ok(!out.includes(key));
  assert.ok(out.includes(hashWorkerKey(key)));

  if (process.platform !== 'win32') {
    assert.equal(statSync(keyFile).mode & 0o777, 0o600);
  }
});

test('insert sql carries only the hash', () => {
  const key = 'secret-key-value';
  const line = insertSql('almond-3d-windows-01', hashWorkerKey(key));

  assert.ok(!line.includes(key));
  assert.match(line, /'[0-9a-f]{64}'/);
});

test('insert sql rejects quotes in the name', () => {
  assert.throws(() => insertSql("x'); DROP TABLE skus; --", 'a'.repeat(64)));
});
