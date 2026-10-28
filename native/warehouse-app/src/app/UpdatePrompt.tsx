import { useEffect, useState } from 'react';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { ConfirmDialog } from '../core/design/ConfirmDialog';

// 데모·개발 빌드는 라이브 업데이트를 받으면 안 된다 — 라이브 설치본(tauri:build:live)만 묻는다
const UPDATES_ENABLED = import.meta.env.PROD && import.meta.env.VITE_APP_STAGE !== 'demo';

/** 켤 때 한 번 새 버전을 확인하고, 있으면 지금 업데이트할지 묻는다 */
export function UpdatePrompt() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [installing, setInstalling] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (!UPDATES_ENABLED) return;
    // 확인이 실패해도(오프라인 등) 앱은 그대로 쓴다
    check()
      .then((found) => setUpdate(found))
      .catch(() => undefined);
  }, []);

  const install = async () => {
    if (!update) return;
    setInstalling(true);
    try {
      await update.downloadAndInstall();
      await relaunch();
    } catch (error) {
      setInstalling(false);
      setFailed(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <>
      <ConfirmDialog
        open={update !== null && !installing && failed === null}
        title="새 버전이 있어요"
        message={`${update?.version ?? ''} 버전으로 지금 업데이트할까요? 업데이트하면 앱이 다시 켜져요.`}
        confirmLabel="업데이트"
        onConfirm={() => void install()}
        onCancel={() => setUpdate(null)}
      />
      {installing && (
        <div role="status" className="fixed inset-x-0 top-0 z-50 bg-[#1D5BD8] py-2 text-center text-white">
          업데이트를 받는 중이에요. 잠시 후 앱이 다시 켜져요.
        </div>
      )}
      {failed !== null && (
        <div role="alert" className="fixed inset-x-0 top-0 z-50 bg-red-600 py-2 text-center text-white">
          업데이트하지 못했어요. 다음에 앱을 켤 때 다시 물어볼게요.
        </div>
      )}
    </>
  );
}
