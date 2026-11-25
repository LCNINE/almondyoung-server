import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashWorkerKey, insertSql, newWorkerKey, withKey } from './new-key.mjs';

test('key is long and random', () => {
  const a = newWorkerKey();

  assert.ok(a.length >= 43);
  assert.notEqual(a, newWorkerKey());
});

test('withKey replaces an existing key line and keeps other settings', () => {
  const out = withKey('SKU3D_SERVER_URL=https://x\nSKU3D_WORKER_KEY=old\n', 'new');

  assert.equal(out, 'SKU3D_SERVER_URL=https://x\nSKU3D_WORKER_KEY=new\n');
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
