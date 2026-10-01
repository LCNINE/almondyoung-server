import { DATE_FORMATS, formatDate } from "@/lib/utils/format-date"
import type { AlmondEditor } from "../../hooks/use-almond-editor"

export function BackupBanner({ editor }: { editor: AlmondEditor }) {
  const { backupOffer, restoreBackup, discardBackup } = editor
  if (!backupOffer) return null
  return (
    <div
      role="status"
      className="flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900"
    >
      <span className="min-w-0 flex-1">
        이 브라우저에 보관된 작업(
        {formatDate(backupOffer.savedAt, DATE_FORMATS.KO_DOT_TIME)})이 지금
        화면과 다릅니다.
      </span>
      <button
        className="rounded bg-amber-900 px-3 py-1 font-semibold text-white"
        onClick={restoreBackup}
      >
        복원
      </button>
      <button className="rounded border px-3 py-1" onClick={discardBackup}>
        버리기
      </button>
    </div>
  )
}
