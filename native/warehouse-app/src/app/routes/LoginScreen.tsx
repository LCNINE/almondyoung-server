import { useState } from 'react';
import { Button } from '../../core/design/Button';
import { useSession } from '../session-context';

export function LoginScreen() {
  const session = useSession();
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  async function onLogin() {
    setBusy(true);
    setStatus('logging in…');
    try {
      await session.login(setStatus);
      setStatus('logged in');
    } catch (e) {
      setStatus(`login error: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto mt-24 flex max-w-xs flex-col items-center gap-4">
      <h1 className="text-2xl font-semibold">Almond WMS</h1>
      <p className="text-sm text-gray-600">물류 작업자 로그인</p>
      <Button className="w-full" disabled={busy} onClick={onLogin}>
        Login
      </Button>
      {status && <p className="text-sm text-gray-600">{status}</p>}
    </div>
  );
}
