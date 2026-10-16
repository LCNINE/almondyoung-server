import type { AlmondEditor } from "../../../hooks/use-almond-editor"

export function IssuesDialog({ editor }: { editor: AlmondEditor }) {
  const { issues, setIssues, warnings, openPreview } = editor
  // 해상도 경고만 남았으면 막지 않고 고객이 고르게 한다 (와우프레스도 막지 않고 책임을 고객에게 둔다)
  const onlyWarnings =
    issues.length > 0 && issues.every((issue) => warnings.includes(issue))
  const blocking = issues.filter((issue) => !warnings.includes(issue))
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="인쇄 전 확인"
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/40"
    >
      <div className="w-[460px] max-w-[95vw] bg-white p-6 shadow-xl">
        <h2 className="mb-3 text-lg font-semibold">인쇄 전 확인</h2>
        {blocking.length > 0 && (
          <ul className="list-disc space-y-2 pl-5 text-sm">
            {blocking.map((issue, i) => (
              <li key={i}>{issue}</li>
            ))}
          </ul>
        )}
        {warnings.length > 0 && (
          <div className={blocking.length ? "mt-4 border-t pt-4" : ""}>
            <p className="mb-2 text-sm font-semibold text-red-600">
              ⚠ 흐리게 인쇄될 수 있는 사진이 있습니다
            </p>
            <ul className="list-disc space-y-2 pl-5 text-sm">
              {warnings.map((warning, i) => (
                <li key={i}>{warning}</li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-slate-500">
              사진을 작게 줄이거나 더 큰 원본으로 바꾸면 선명해집니다. 그대로
              진행해 인쇄가 흐리게 나온 경우 재작업·환불이 어렵습니다.
            </p>
          </div>
        )}
        <div className="mt-5 flex gap-2">
          <button
            className="flex-1 bg-slate-900 py-2 text-white"
            onClick={() => setIssues([])}
          >
            편집 화면으로 돌아가기
          </button>
          {onlyWarnings && (
            <button
              className="flex-1 border border-slate-300 py-2"
              onClick={openPreview}
            >
              그대로 진행
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
