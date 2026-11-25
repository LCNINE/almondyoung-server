import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const GLB_MAX_BYTES = 2 * 1024 * 1024;
export const RENDER_COUNT = 6;

const REVIEW_KEYS = [
  'summary',
  'verdict',
  'issues',
  'proposals',
  'autoFixes',
  'unseenFaces',
  'assumptions',
  'needsPhotos',
  'dimensionsUsed',
];

export function glbJson(bytes) {
  if (bytes.length < 20 || bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2) {
    throw new Error('glTF 2.0 바이너리가 아니에요');
  }

  const length = bytes.readUInt32LE(12);

  if (bytes.toString('ascii', 16, 20) !== 'JSON') {
    throw new Error('첫 청크가 JSON 이 아니에요');
  }

  return JSON.parse(bytes.toString('utf8', 20, 20 + length));
}

// 텍스처까지 GLB 안에 있어야 한다 — 바깥 파일을 가리키는 uri 는 실패
export function externalUris(gltf) {
  return [...(gltf.images ?? []), ...(gltf.buffers ?? [])]
    .map((entry) => entry.uri)
    .filter((uri) => typeof uri === 'string' && !uri.startsWith('data:'));
}

export function reviewProblem(review) {
  const missing = REVIEW_KEYS.filter((key) => !(key in review));

  if (missing.length > 0) {
    return `review.json 에 빠진 칸: ${missing.join(', ')}`;
  }

  if (!['ready_for_review', 'needs_revision', 'needs_photos'].includes(review.verdict)) {
    return `review.verdict 값이 맞지 않아요: ${review.verdict}`;
  }

  return null;
}

export async function validateGlb(bytes, validatorModule) {
  const validator = createRequire(import.meta.url)(validatorModule);
  const report = await validator.validateBytes(new Uint8Array(bytes), { maxIssues: 50 });

  return {
    errors: report.issues.numErrors,
    warnings: report.issues.numWarnings,
    messages: report.issues.messages.filter((m) => m.severity === 0).map((m) => `${m.code}: ${m.message}`),
    validatorVersion: report.validatorVersion,
  };
}

export async function judgeOutputs(iterDir, { validatorModule }) {
  const glbPath = join(iterDir, 'model.glb');

  if (!existsSync(glbPath)) {
    return { ok: false, reason: 'model.glb 가 없어요' };
  }

  const bytes = readFileSync(glbPath);

  if (bytes.length > GLB_MAX_BYTES) {
    return { ok: false, reason: `model.glb 가 ${bytes.length} 바이트예요. ${GLB_MAX_BYTES} 이하로 줄여 주세요` };
  }

  let gltf;

  try {
    gltf = glbJson(bytes);
  } catch (error) {
    return { ok: false, reason: String(error) };
  }

  const external = externalUris(gltf);

  if (external.length > 0) {
    return { ok: false, reason: `바깥 파일을 가리켜요: ${external.join(', ')}` };
  }

  const validation = await validateGlb(bytes, validatorModule);

  if (validation.errors > 0) {
    return { ok: false, reason: `glTF Validator 오류 ${validation.errors}건: ${validation.messages.join(' / ')}` };
  }

  const rendersDir = join(iterDir, 'renders');
  const renders = existsSync(rendersDir)
    ? readdirSync(rendersDir)
        .filter((name) => name.endsWith('.png'))
        .sort()
        .map((name) => join(rendersDir, name))
    : [];

  if (renders.length < RENDER_COUNT) {
    return { ok: false, reason: `렌더 이미지가 ${renders.length}장이에요. ${RENDER_COUNT}장 필요해요` };
  }

  const reviewPath = join(iterDir, 'review.json');

  if (!existsSync(reviewPath)) {
    return { ok: false, reason: 'review.json 이 없어요' };
  }

  let review;

  try {
    review = JSON.parse(readFileSync(reviewPath, 'utf8'));
  } catch {
    return { ok: false, reason: 'review.json 이 JSON 이 아니에요' };
  }

  const problem = reviewProblem(review);

  if (problem) {
    return { ok: false, reason: problem };
  }

  return { ok: true, glbPath, bytes: bytes.length, renders, review, validation };
}
