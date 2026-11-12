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
  CopyPlus,
} from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import type { AlmondEditor } from "../../hooks/use-almond-editor"
import { OrderSteps } from "./order-steps"

const ORDER_HINT_KEY = "almond-editor-order-hint-seen"

// 처음 연 손님에게 주문은 오른쪽 위 버튼에서 시작한다는 걸 한 번만 알린다
function useOrderHint(enabled: boolean) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!enabled) return
    try {
      setOpen(!localStorage.getItem(ORDER_HINT_KEY))
    } catch {
      setOpen(true)
    }
  }, [enabled])
  const dismiss = () => {
    setOpen(false)
    try {
      localStorage.setItem(ORDER_HINT_KEY, "1")
    } catch {}
  }

  return { open, dismiss }
}

export function EditorHeader({ editor }: { editor: AlmondEditor }) {
  const {
    mode,
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
    save,
    saveAs,
    savedId,
    dirty,
    openLoad,
    importJson,
    copied,
    editable,
    removeSelected,
    group,
    removeGroup,
    copySelected,
    pasteCopied,
    cutSelected,
  } = editor
  const t = useTranslations("almondEditor")
  const customer = mode !== "designer"
  const hint = useOrderHint(customer)

  return (
    <header className="relative flex h-[72px] shrink-0 items-stretch border-b bg-white text-xs shadow-sm">
      <button
        onClick={() => {
          if (
            dirty &&
            !window.confirm("저장하지 않은 변경사항이 있습니다. 나갈까요?")
          )
            return
          window.history.back()
        }}
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
            disabled: !editable && group.length < 2,
            click: cutSelected,
          },
          {
            label: "복사",
            icon: Copy,
            disabled: !selected && group.length < 2,
            click: copySelected,
          },
          {
            label: "붙여넣기",
            icon: Clipboard,
            disabled: !copied.length,
            click: pasteCopied,
          },
          {
            label: "화면 이동",
            icon: Hand,
            disabled: false,
            click: () => setMoveMode(!moveMode),
          },
          {
            label: "삭제",
            icon: Trash2,
            disabled: !editable && group.length < 2,
            click: group.length > 1 ? removeGroup : removeSelected,
          },
        ].map(({ label, icon: Icon, disabled, click }) => (
          <button
            key={label}
            title={label}
            disabled={disabled}
            onClick={click}
            className={`flex h-14 min-w-[55px] flex-col items-center justify-center gap-1 rounded text-[11px] hover:bg-slate-100 disabled:opacity-30 ${label === "화면 이동" && moveMode ? "bg-slate-100 text-blue-600" : ""}`}
          >
            <Icon size={19} />
            {label}
          </button>
        ))}
      </div>
      {customer && (
        <div className="mx-auto flex items-center px-4">
          <OrderSteps current={1} />
        </div>
      )}
      <div className={`flex items-stretch ${customer ? "" : "ml-auto"}`}>
        {[
          {
            label: "미리보기",
            icon: Eye,
            click: () => {
              setPreviewSide(side)
              setPreview(true)
            },
          },
          {
            label: "불러오기",
            icon: FolderOpen,
            click: openLoad,
          },
          { label: "저장", icon: Save, click: save },
          ...(savedId
            ? [
                {
                  label: "다른 이름으로 저장",
                  icon: CopyPlus,
                  click: saveAs,
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
        {customer ? (
          <button
            onClick={() => {
              hint.dismiss()
              complete()
            }}
            className="flex min-w-[190px] flex-col items-start justify-center gap-0.5 bg-[#303030] px-6 text-white hover:bg-black"
          >
            <span className="text-base font-bold">{t("goOrder")} →</span>
            <span className="text-[11px] text-slate-300">
              {t("goOrderHint")}
            </span>
          </button>
        ) : (
          <button
            onClick={complete}
            className="min-w-[145px] bg-[#303030] px-5 text-base font-bold text-white hover:bg-black"
          >
            편집완료 &gt;
          </button>
        )}
      </div>
      {hint.open && (
        <div
          role="status"
          className="absolute top-full right-4 z-30 mt-3 flex w-[300px] flex-col gap-1.5 rounded-xl bg-[#20232a] px-4 py-3.5 text-white shadow-[0_8px_24px_rgba(0,0,0,0.18)]"
        >
          <strong className="text-sm">{t("orderHint.title")}</strong>
          <p className="text-[13px] leading-relaxed text-slate-200">
            {t("orderHint.body")}
          </p>
          <button
            onClick={hint.dismiss}
            className="self-end py-1 text-xs underline"
          >
            {t("orderHint.dismiss")}
          </button>
        </div>
      )}
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
