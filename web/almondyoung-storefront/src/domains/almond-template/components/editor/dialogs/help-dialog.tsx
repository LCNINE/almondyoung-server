import { X } from "lucide-react"
import type { AlmondEditor } from "../../../hooks/use-almond-editor"

export function HelpDialog({ editor }: { editor: AlmondEditor }) {
  const { setHelpOpen, helpTab, setHelpTab } = editor
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="편집 도움말"
      className="absolute inset-0 z-30 flex justify-end bg-black/30"
      onClick={() => setHelpOpen(false)}
    >
      <div
        className="h-full w-[380px] max-w-[90vw] overflow-y-auto bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-xl font-bold">도움말</h2>
          <button
            aria-label="도움말 닫기"
            className="-mr-2 flex size-10 items-center justify-center rounded hover:bg-slate-100"
            onClick={() => setHelpOpen(false)}
          >
            <X size={24} />
          </button>
        </div>
        <div className="mb-5 grid grid-cols-4 gap-1 text-xs">
          {(
            [
              ["editing", "편집기능"],
              ["shortcuts", "단축키"],
              ["image", "이미지"],
              ["print", "인쇄 주의"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              className={`border px-1 py-2 ${helpTab === id ? "bg-slate-900 text-white" : ""}`}
              onClick={() => setHelpTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="space-y-3 text-sm leading-6">
          {helpTab === "editing" ? (
            <>
              <p>왼쪽 메뉴에서 텍스트·이미지·도형·모양틀을 추가합니다.</p>
              <p>
                캔버스의 요소를 끌어 이동하고 모서리 핸들로 크기를 바꾸세요.
                위쪽 원형 핸들로 회전합니다.
              </p>
              <p>
                레이어에서 표시·잠금을 바꾸고, 오른쪽 패널에서 색상·순서·반전을
                조절합니다.
              </p>
            </>
          ) : helpTab === "shortcuts" ? (
            <>
              <p>⌘/Ctrl + Z: 이전 · Shift + ⌘/Ctrl + Z: 이후</p>
              <p>⌘/Ctrl + C/V/X: 복사·붙여넣기·잘라내기</p>
              <p>Delete: 선택 요소 삭제 · Esc: 선택 해제</p>
            </>
          ) : helpTab === "image" ? (
            <>
              <p>PNG·JPG·WebP, 파일당 5MB 이하를 업로드할 수 있습니다.</p>
              <p>
                선택한 이미지의 자르기 확대·위치를 조절하고, 흰 배경 제거 뒤
                가장자리를 확인하세요.
              </p>
              <p>
                해상도 표시는 접수 파일 크기 기준입니다. 미니배너 700dpi 권장,
                나머지 300dpi 이상입니다.
              </p>
            </>
          ) : (
            <>
              <p>
                재단선과 안전선 안에 중요한 글자와 QR코드를 배치하세요. PET 배너
                네 모서리에는 타공 표시가 있습니다.
              </p>
              <p>미리보기에서 앞·뒷면과 인쇄 색상 차이를 확인하세요.</p>
              <p>
                EPS 시험 출력은 와우프레스 접수 승인을 보장하지 않습니다. 상품별
                칼선과 실제 샘플 접수가 필요합니다.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
