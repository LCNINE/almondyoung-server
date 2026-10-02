import type { AlmondEditor } from "../../../hooks/use-almond-editor"

export function IssuesDialog({ editor }: { editor: AlmondEditor }) {
  const { issues, setIssues } = editor
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="인쇄 전 확인"
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/40"
    >
      <div className="w-[460px] max-w-[95vw] bg-white p-6 shadow-xl">
        <h2 className="mb-3 text-lg font-semibold">인쇄 전 확인</h2>
        <ul className="list-disc space-y-2 pl-5 text-sm">
          {issues.map((issue, i) => (
            <li key={i}>{issue}</li>
          ))}
        </ul>
        <button
          className="mt-5 w-full bg-slate-900 py-2 text-white"
          onClick={() => setIssues([])}
        >
          편집 화면으로 돌아가기
        </button>
      </div>
    </div>
  )
}
