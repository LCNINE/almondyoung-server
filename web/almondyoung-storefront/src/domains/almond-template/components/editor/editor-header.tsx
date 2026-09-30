import {
  Undo2,
  Redo2,
  Scissors,
  Copy,
  Clipboard,
  Hand,
  Trash2,
  Eye,
  FolderOpen,
  Save,
} from "lucide-react"
import { PRINT_PRODUCTS } from "../../lib/catalog"
import type { AlmondEditor } from "../../hooks/use-almond-editor"

export function EditorHeader({ editor }: { editor: AlmondEditor }) {
  const {
    mode,
    design,
    history,
    future,
    undo,
    redo,
    side,
    moveMode,
    setMoveMode,
    setPreviewSide,
    setPreview,
    selected,
    complete,
    inputRef,
    setSaveDialog,
    setSaveName,
    openLoad,
    importJson,
    copied,
    editable,
    removeSelected,
    copySelected,
    pasteCopied,
    cutSelected,
  } = editor
  return (
    <header className="flex h-[72px] shrink-0 items-stretch border-b bg-white text-xs shadow-sm">
      <button
        onClick={() => window.history.back()}
        className="w-[160px] border-r px-5 text-left text-lg font-black tracking-tight"
      >
        ALMOND<span className="text-amber-500">YOUNG</span>
        <span className="block text-[9px] font-medium tracking-[.36em] text-slate-400">
          TEMPLATE
        </span>
      </button>
      <div className="flex items-center gap-1 px-3">
        {[
          {
            label: "이전",
            icon: Undo2,
            disabled: !history.length,
            click: undo,
          },
          {
            label: "이후",
            icon: Redo2,
            disabled: !future.length,
            click: redo,
          },
          {
            label: "잘라내기",
            icon: Scissors,
            disabled: !editable,
            click: cutSelected,
          },
          {
            label: "복사",
            icon: Copy,
            disabled: !selected,
            click: copySelected,
          },
          {
            label: "붙여넣기",
            icon: Clipboard,
            disabled: !copied,
            click: pasteCopied,
          },
          {
            label: "이동",
            icon: Hand,
            disabled: false,
            click: () => setMoveMode(!moveMode),
          },
          {
            label: "삭제",
            icon: Trash2,
            disabled: !editable,
            click: removeSelected,
          },
        ].map(({ label, icon: Icon, disabled, click }) => (
          <button
            key={label}
            title={label}
            disabled={disabled}
            onClick={click}
            className={`flex h-14 min-w-[55px] flex-col items-center justify-center gap-1 rounded text-[11px] hover:bg-slate-100 disabled:opacity-30 ${label === "이동" && moveMode ? "bg-slate-100 text-blue-600" : ""}`}
          >
            <Icon size={19} />
            {label}
          </button>
        ))}
      </div>
      <div className="ml-auto flex items-stretch">
        {[
          {
            label: "미리보기",
            icon: Eye,
            click: () => {
              setPreviewSide(side)
              setPreview(true)
            },
          },
          ...(mode === "designer"
            ? [
                {
                  label: "불러오기",
                  icon: FolderOpen,
                  click: openLoad,
                },
                {
                  label: "임시 저장",
                  icon: Save,
                  click: () => {
                    setSaveName(
                      design.title ||
                        PRINT_PRODUCTS[design.productId]?.title ||
                        "내 시안"
                    )
                    setSaveDialog(true)
                  },
                },
              ]
            : []),
        ].map(({ label, icon: Icon, click }) => (
          <button
            key={label}
            onClick={click}
            className="flex min-w-[95px] items-center justify-center gap-2 px-2 hover:bg-slate-50"
          >
            <Icon size={17} />
            {label}
          </button>
        ))}
        <button
          onClick={complete}
          className="min-w-[145px] bg-[#303030] px-5 text-base font-bold text-white hover:bg-black"
        >
          {mode === "designer" ? "편집완료 >" : "인쇄 파일 확인 >"}
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void importJson(file)
          event.target.value = ""
        }}
      />
    </header>
  )
}
