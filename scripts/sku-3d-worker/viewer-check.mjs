import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);

const MODEL_VIEWER = 'https://cdn.jsdelivr.net/npm/@google/model-viewer@4.0.0/dist/model-viewer.min.js';
export const MIN_DRAWN_RATIO = 0.005;
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
  const done = (state, shot = '') => {
    document.body.dataset.viewer = state;
    document.body.dataset.shot = shot;
  };
  await customElements.whenDefined('model-viewer');
  customElements.get('model-viewer').meshoptDecoderLocation = '${MESHOPT_DECODER}';
  const v = document.getElementById('v');
  v.addEventListener('error', () => done('error'));
  v.addEventListener('load', async () => {
    await new Promise((r) => setTimeout(r, 800));
    // 실제로 그려진 화면을 받아 모델 픽셀이 찍혔는지 센다 — 배경은 CSS 라 캔버스에선 투명이다
    const shot = v.toDataURL('image/png');
    const img = new Image();
    img.src = shot;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, c.width, c.height).data;
    let drawn = 0;
    for (let k = 3; k < px.length; k += 4) {
      if (px[k] > 8) {
        drawn += 1;
      }
    }
    done(drawn / (c.width * c.height) > ${MIN_DRAWN_RATIO} ? 'visible' : 'invisible', shot);
  });
  v.src = '${src}';
</script>
</body></html>`;
}

export function viewerStateOf(dom) {
  return /data-viewer="([a-z]+)"/.exec(dom)?.[1] ?? 'unknown';
}

export function viewerShotOf(dom) {
  const base64 = /data-shot="data:image\/png;base64,([A-Za-z0-9+/=]+)"/.exec(dom)?.[1];

  return base64 ? Buffer.from(base64, 'base64') : null;
}

const EDGE_FLAGS = ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=800,800', '--virtual-time-budget=20000'];

// 워커(Codex 아님)가 압축 GLB 를 실제 웹 뷰어에 띄워 본다. 판정과 캡처가 같은 실행의 같은 화면이다
export async function viewerCheck({ edgeBin, glbPath, outDir, signal }) {
  mkdirSync(outDir, { recursive: true });

  const htmlPath = join(outDir, 'viewer.html');
  const screenshot = join(outDir, 'viewer-0.png');

  writeFileSync(htmlPath, viewerHtml(readFileSync(glbPath)));

  const { stdout } = await run(edgeBin, [...EDGE_FLAGS, '--dump-dom', pathToFileURL(htmlPath).href], {
    windowsHide: true,
    timeout: 90_000,
    maxBuffer: 64 * 1024 * 1024,
    signal,
  });
  const state = viewerStateOf(stdout);
  const shot = viewerShotOf(stdout);

  if (shot) {
    writeFileSync(screenshot, shot);
  }

  return { ok: state === 'visible' && shot !== null, state, screenshot };
}
