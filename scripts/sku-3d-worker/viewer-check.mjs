import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';


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
    // 사람이 보는 캡처는 쇼핑몰 뷰어처럼 #c6c6c6 배경 위에 둔다(판정은 위의 투명 캔버스로 이미 끝났다)
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = '#c6c6c6';
    ctx.fillRect(0, 0, c.width, c.height);
    done(drawn / (c.width * c.height) > ${MIN_DRAWN_RATIO} ? 'visible' : 'invisible', c.toDataURL('image/png'));
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

const EDGE_FLAGS = [
  '--headless=new',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--window-size=800,800',
  // 포트는 프로필의 DevToolsActivePort 로 읽는다
  '--remote-debugging-port=0',
];
const VIEWER_WAIT_MS = 60_000;

// 가상 시간(--virtual-time-budget)에서는 model-viewer 가 마지막 렌더 단계에서 멈춘다 — 실제 시간으로 기다리며 디버깅 포트로 판정을 읽는다
async function waitForDevToolsPort(profile, timeoutMs, launchError) {
  const file = join(profile, 'DevToolsActivePort');
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (launchError()) {
      throw new Error(`브라우저를 띄우지 못했어요: ${launchError().message}`);
    }

    if (existsSync(file)) {
      const port = Number(readFileSync(file, 'utf8').split(/\r?\n/)[0]);

      if (port > 0) {
        return port;
      }
    }

    await new Promise((r) => setTimeout(r, 250));
  }

  throw new Error('브라우저 디버깅 포트를 찾지 못했어요');
}

function devtools(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);

    pending.get(message.id)?.(message.result);
    pending.delete(message.id);
  };

  const opened = new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error('디버깅 연결 실패'));
  });
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      id += 1;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });

  return { opened, send, close: () => ws.close() };
}

// Windows Edge 는 실행 파일이 실제 브라우저를 따로 띄우고 바로 끝날 수 있다(종료 코드 0) —
// 띄운 프로세스 생사에 기대지 않고 프로필의 DevToolsActivePort 로 포트를 찾고, 끝나면 디버깅 연결로 브라우저를 닫는다.
// 가상 시간(--virtual-time-budget)은 model-viewer 가 마지막 렌더 단계에서 멈춰서 쓰지 않는다
async function readViewerState(edgeBin, url, signal) {
  const profile = mkdtempSync(join(tmpdir(), 'sku3d-edge-'));
  const launcher = spawn(edgeBin, [...EDGE_FLAGS, `--user-data-dir=${profile}`, url], {
    windowsHide: true,
    shell: false,
    stdio: 'ignore',
  });
  let browserSocket = null;
  let launchError = null;

  // 실행 파일이 없거나 못 띄우면 워커가 죽지 않게 받아서 검사 도구 실패로 돌린다
  launcher.on('error', (error) => {
    launchError = error;
  });

  try {
    const port = await waitForDevToolsPort(profile, 30_000, () => launchError);
    const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();

    browserSocket = devtools(version.webSocketDebuggerUrl);
    await browserSocket.opened;

    let page = null;

    for (let i = 0; i < 40 && !page; i += 1) {
      const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();

      page = pages.find((p) => p.type === 'page' && p.url.startsWith('file:'));

      if (!page) {
        await new Promise((r) => setTimeout(r, 250));
      }
    }

    if (!page) {
      throw new Error('검사 페이지가 열리지 않았어요');
    }

    const pageSocket = devtools(page.webSocketDebuggerUrl);

    await pageSocket.opened;

    const evaluate = async (expression) =>
      (await pageSocket.send('Runtime.evaluate', { expression, returnByValue: true }))?.result?.value;
    const deadline = Date.now() + VIEWER_WAIT_MS;
    let state = 'pending';

    while (Date.now() < deadline && !signal?.aborted) {
      // 페이지가 아직 안 열렸으면 값이 없다 — 기다린다
      state = (await evaluate('document.body && document.body.dataset.viewer')) || 'pending';

      if (state !== 'pending') {
        break;
      }

      await new Promise((r) => setTimeout(r, 500));
    }

    const shot = state === 'pending' ? '' : ((await evaluate('document.body.dataset.shot')) ?? '');

    pageSocket.close();

    return { state, shot };
  } finally {
    if (browserSocket) {
      await Promise.race([browserSocket.send('Browser.close'), new Promise((r) => setTimeout(r, 3000))]);
      browserSocket.close();
    }

    launcher.kill();
    await new Promise((r) => setTimeout(r, 500));
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
}

// 워커(Codex 아님)가 압축 GLB 를 실제 웹 뷰어에 띄워 본다. 판정과 캡처가 같은 실행의 같은 화면이다
export async function viewerCheck({ edgeBin, glbPath, outDir, signal }) {
  mkdirSync(outDir, { recursive: true });

  const htmlPath = join(outDir, 'viewer.html');
  const screenshot = join(outDir, 'viewer-0.png');

  writeFileSync(htmlPath, viewerHtml(readFileSync(glbPath)));

  const { state, shot } = await readViewerState(edgeBin, pathToFileURL(htmlPath).href, signal);
  const bytes = viewerShotOf(`data-shot="${shot}"`);

  // 판정 표시를 못 읽었으면 모델이 아니라 검사 도구가 실패한 것이다
  if (!['visible', 'invisible', 'error'].includes(state)) {
    throw Object.assign(new Error(`웹 뷰어 검사 페이지가 ${VIEWER_WAIT_MS / 1000}초 안에 끝나지 않았어요(상태 ${state})`), {
      tooling: true,
    });
  }

  if (bytes) {
    writeFileSync(screenshot, bytes);
  }

  return { ok: state === 'visible' && bytes !== null, state, screenshot };
}
