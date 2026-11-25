import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';

export function codexArgs({ sessionId, workdir, schemaPath, lastMessagePath, images }) {
  // resume 은 -s·-C 를 받지 않는다 — 샌드박스는 설정값으로, 작업 폴더는 프로세스 cwd 로 준다
  const common = [
    '--json',
    '-c',
    'sandbox_mode="workspace-write"',
    '--skip-git-repo-check',
    '--output-schema',
    schemaPath,
    '-o',
    lastMessagePath,
  ];

  if (sessionId) {
    // resume 에 -i 를 붙이면 프롬프트를 삼킨다 — 이미지 경로는 프롬프트에 적는다
    return ['exec', 'resume', ...common, sessionId, '-'];
  }

  return ['exec', ...common, '-C', workdir, ...images.flatMap((image) => ['-i', image]), '-'];
}

// codex exec --json 한 줄에서 워커가 쓰는 것만 뽑는다
export function readCodexEvent(line) {
  let event;

  try {
    event = JSON.parse(line);
  } catch {
    return null;
  }

  if (event.type === 'thread.started' && typeof event.thread_id === 'string') {
    return { kind: 'session', sessionId: event.thread_id };
  }

  if (event.type === 'item.completed' && event.item) {
    const item = event.item;

    if (item.type === 'agent_message' && item.text) {
      return { kind: 'progress', body: item.text.slice(0, 480) };
    }

    if (item.type === 'command_execution' && item.command) {
      return { kind: 'progress', body: `실행: ${String(item.command).slice(0, 200)}` };
    }
  }

  if (event.type === 'turn.failed' || event.type === 'error') {
    return { kind: 'error', body: JSON.stringify(event).slice(0, 480) };
  }

  return null;
}

export function killTree(child) {
  if (!child.pid || child.exitCode !== null) {
    return;
  }

  if (process.platform === 'win32') {
    // Codex 아래 Blender 까지 같이 끈다
    try {
      execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } catch {
      // 이미 끝났으면 무시
    }

    return;
  }

  child.kill('SIGTERM');
}

// 프롬프트는 stdin 으로만 넣는다 — 작업자 문장을 명령줄에 붙이지 않는다
export function runCodex({ bin, args, cwd, env, prompt, timeoutMs, onEvent, signal }) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { cwd, env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    let settled = false;
    const finish = (result) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      resolve(result);
    };
    const abort = () => {
      killTree(child);
      finish({ code: null, aborted: true, stderr });
    };
    const timer = setTimeout(() => {
      killTree(child);
      finish({ code: null, timedOut: true, stderr });
    }, timeoutMs);

    signal?.addEventListener('abort', abort);
    createInterface({ input: child.stdout }).on('line', (line) => {
      const event = readCodexEvent(line);

      if (event) {
        onEvent(event);
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-4000);
    });
    child.on('error', (error) => finish({ code: null, error, stderr }));
    child.on('close', (code) => finish({ code, stderr }));
    child.stdin.end(prompt);
  });
}
