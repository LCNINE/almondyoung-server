import { useEffect, useRef } from "react"
import type { Layer } from "../lib/document"

type Params = {
  preview: boolean
  textDialog: string | null
  issues: string[]
  saveDialog: boolean
  loadDialog: boolean
  selected: Layer | undefined
  copied: Layer[]
  hasGroup: boolean
  editable: boolean | undefined
  setSelectedId: (id: string | null) => void
  setPreview: (open: boolean) => void
  setTextDialog: (text: string | null) => void
  setHelpOpen: (open: boolean) => void
  setIssues: (issues: string[]) => void
  setSaveDialog: (open: boolean) => void
  setLoadDialog: (open: boolean) => void
  undo: () => void
  redo: () => void
  copySelected: () => void
  pasteCopied: () => void
  cutSelected: () => void
  removeSelected: () => void
  nudgeSelected: (dx: number, dy: number) => void
  flipSelected: (axis: "x" | "y") => void
  togglePen: () => void
  togglePencil: () => void
  mergedGroup: boolean
  mergeGroup: () => void
  splitGroup: () => void
  setOrder: (position: "top" | "up" | "down" | "bottom") => void
  selectAll: () => void
  duplicateSelected: () => void
  toggleLock: () => void
  canSave: boolean
  save: () => void
  saveNamed: () => void
}

// 글자를 치는 칸에서는 방향키·Delete 가 그 칸의 몫이다
const TEXT_INPUTS = new Set([
  "text",
  "number",
  "search",
  "email",
  "url",
  "tel",
  "password",
])
// 슬라이더에 포커스가 남아도 글자 단축키는 편집기가 받는다. 값을 움직이는 키만 슬라이더 몫이다
const SLIDER_KEYS = /^(Arrow|Page|Home$|End$)/
function typing(event: KeyboardEvent) {
  const target = event.target
  if (target instanceof HTMLInputElement)
    return target.type === "range"
      ? SLIDER_KEYS.test(event.key)
      : TEXT_INPUTS.has(target.type)
  return (
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  )
}

// 한글 자판이면 event.key 가 "ㅔ"·"ㅖ" 로 와서 P 를 못 알아본다. 글자 단축키는 자판 위치로 읽는다
function letter(event: KeyboardEvent) {
  return /^Key[A-Z]$/.test(event.code)
    ? event.code.slice(3).toLowerCase()
    : event.key.toLowerCase()
}

export function useEditorShortcuts({
  preview,
  textDialog,
  issues,
  saveDialog,
  loadDialog,
  selected,
  copied,
  hasGroup,
  editable,
  setSelectedId,
  setPreview,
  setTextDialog,
  setHelpOpen,
  setIssues,
  setSaveDialog,
  setLoadDialog,
  undo,
  redo,
  copySelected,
  pasteCopied,
  cutSelected,
  removeSelected,
  nudgeSelected,
  flipSelected,
  togglePen,
  togglePencil,
  mergedGroup,
  mergeGroup,
  splitGroup,
  setOrder,
  selectAll,
  duplicateSelected,
  toggleLock,
  canSave,
  save,
  saveNamed,
}: Params) {
  const latestSave = useRef(save)
  latestSave.current = save
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && letter(event) === "s") {
        event.preventDefault()
        if (!canSave || event.repeat) return
        if (saveDialog) saveNamed()
        else if (
          !preview &&
          textDialog === null &&
          !issues.length &&
          !loadDialog
        ) {
          const active = document.activeElement
          if (
            active instanceof HTMLInputElement ||
            active instanceof HTMLTextAreaElement
          ) {
            // 입력 중인 문구·숫자는 blur 때 반영되므로 그 렌더가 끝난 뒤 저장한다
            active.blur()
            setTimeout(() => latestSave.current())
          } else save()
        }
        return
      }
      // 체크박스·버튼·select 에 포커스가 남아 있어도 캔버스 단축키는 그대로 받는다
      if (typing(event)) return
      if (event.key === "Escape") {
        setSelectedId(null)
        setPreview(false)
        setTextDialog(null)
        setHelpOpen(false)
        setIssues([])
        setSaveDialog(false)
        setLoadDialog(false)
        return
      }
      if (
        preview ||
        textDialog !== null ||
        issues.length ||
        saveDialog ||
        loadDialog
      )
        return
      const command = event.metaKey || event.ctrlKey
      if (command && letter(event) === "z") {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
      } else if (command && letter(event) === "y") {
        event.preventDefault()
        redo()
      } else if (command && letter(event) === "c") {
        if (selected || hasGroup) {
          event.preventDefault()
          copySelected()
        }
      } else if (command && letter(event) === "v") {
        if (copied.length) {
          event.preventDefault()
          pasteCopied()
        }
      } else if (command && letter(event) === "x") {
        if (editable) {
          event.preventDefault()
          cutSelected()
        }
      } else if (command && letter(event) === "d") {
        event.preventDefault()
        if (editable) duplicateSelected()
      } else if (command && event.code === "Digit2") {
        event.preventDefault()
        if (selected) toggleLock()
      } else if (command && letter(event) === "a") {
        event.preventDefault()
        selectAll()
      } else if (command && letter(event) === "g") {
        event.preventDefault()
        if (event.shiftKey) {
          if (mergedGroup) splitGroup()
        } else if (hasGroup && !mergedGroup) mergeGroup()
      } else if (
        command &&
        (event.code === "BracketRight" || event.code === "BracketLeft")
      ) {
        // 브라우저의 뒤로·앞으로 가기로 새지 않게 고른 게 없어도 막는다
        event.preventDefault()
        if ((selected || hasGroup) && editable) {
          const up = event.code === "BracketRight"
          setOrder(
            event.shiftKey ? (up ? "top" : "bottom") : up ? "up" : "down"
          )
        }
      } else if (!command && !event.shiftKey && letter(event) === "t") {
        event.preventDefault()
        setTextDialog("")
      } else if (
        !command &&
        event.shiftKey &&
        (letter(event) === "h" || letter(event) === "v")
      ) {
        if (editable) {
          event.preventDefault()
          flipSelected(letter(event) === "h" ? "x" : "y")
        }
      } else if (!command && letter(event) === "p") {
        event.preventDefault()
        if (event.shiftKey) togglePencil()
        else togglePen()
      } else if (event.key.startsWith("Arrow") && editable) {
        event.preventDefault()
        const step = event.shiftKey ? 10 : 1
        nudgeSelected(
          event.key === "ArrowLeft"
            ? -step
            : event.key === "ArrowRight"
              ? step
              : 0,
          event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0
        )
      } else if (
        (event.key === "Delete" || event.key === "Backspace") &&
        editable
      ) {
        event.preventDefault()
        removeSelected()
      }
    }
    window.addEventListener("keydown", shortcut)
    return () => window.removeEventListener("keydown", shortcut)
  })
}
