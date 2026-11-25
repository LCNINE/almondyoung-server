import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);

const MODEL_VIEWER = 'https://cdn.jsdelivr.net/npm/@google/model-viewer@4.0.0/dist/model-viewer.min.js';
const MESHOPT_DECODER = 'https://cdn.jsdelivr.net/npm/meshoptimizer@0.24.0/meshopt_decoder.js';

// 쇼핑몰 뷰어와 같은 조건 — 배경 #c6c6c6, 극각 75°. GLB 는 data URI 로 넣는다(file:// 은 옆 파일을 못 읽는다)
export function viewerHtml(glbBytes) {
  const src = `data:model/gltf-binary;base64,${glbBytes.toString('base64')}`;

  return `<!doctype html>
<html><head><meta charset="utf-8">
<script type="module" src="${MODEL_VIEWER}"></script>
<style>html,body{margin:0;background:#c6c6c6}model-viewer{width:800px;height:800px;background:#c6c6c6}</style>
</head><body data-viewer="pending">
<model-viewer id="v" camera-orbit="0deg 75deg 150%"></model-viewer>
<script type="module">
  await customElements.whenDefined('model-viewer');
  customElements.get('model-viewer').meshoptDecoderLocation = '${MESHOPT_DECODER}';
  const v = document.getElementById('v');
  v.addEventListener('error', () => { document.body.dataset.viewer = 'error'; });
  v.addEventListener('load', () => {
    requestAnimationFrame(() => { document.body.dataset.viewer = v.modelIsVisible ? 'visible' : 'invisible'; });
  });
  v.src = '${src}';
</script>
</body></html>`;
}

export function viewerStateOf(dom) {
  return /data-viewer="([a-z]+)"/.exec(dom)?.[1] ?? 'unknown';
}

const EDGE_FLAGS = ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=800,800', '--virtual-time-budget=20000'];

// 워커(Codex 아님)가 압축 GLB 를 실제 웹 뷰어에 띄워 본다. 보이지 않으면 실패, 화면은 사람 비교용으로 남긴다
export async function viewerCheck({ edgeBin, glbPath, outDir }) {
  mkdirSync(outDir, { recursive: true });

  const htmlPath = join(outDir, 'viewer.html');
  const screenshot = join(outDir, 'viewer-0.png');

  writeFileSync(htmlPath, viewerHtml(readFileSync(glbPath)));

  const url = pathToFileURL(htmlPath).href;
  const options = { windowsHide: true, timeout: 90_000, maxBuffer: 64 * 1024 * 1024 };
  const { stdout } = await run(edgeBin, [...EDGE_FLAGS, '--dump-dom', url], options);
  const state = viewerStateOf(stdout);

  await run(edgeBin, [...EDGE_FLAGS, `--screenshot=${screenshot}`, url], options);

  return { ok: state === 'visible', state, screenshot };
}
