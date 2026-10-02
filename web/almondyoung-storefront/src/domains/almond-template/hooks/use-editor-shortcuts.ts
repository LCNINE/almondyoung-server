import { useEffect } from "react"
import type { Layer } from "../lib/document"

type Params = {
  preview: boolean
  textDialog: string | null
  helpOpen: boolean
  issues: string[]
  saveDialog: boolean
  loadDialog: boolean
  selected: Layer | undefined
  copied: Layer | null
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
}

export function useEditorShortcuts({
  preview,
  textDialog,
  helpOpen,
  issues,
  saveDialog,
  loadDialog,
  selected,
  copied,
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
}: Params) {
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement
      )
        return
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
        helpOpen ||
        issues.length ||
        saveDialog ||
        loadDialog
      )
        return
      const command = event.metaKey || event.ctrlKey
      if (command && event.key.toLowerCase() === "z") {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
      } else if (command && event.key.toLowerCase() === "c") {
        if (selected) {
          event.preventDefault()
          copySelected()
        }
      } else if (command && event.key.toLowerCase() === "v") {
        if (copied) {
          event.preventDefault()
          pasteCopied()
        }
      } else if (command && event.key.toLowerCase() === "x") {
        if (editable) {
          event.preventDefault()
          cutSelected()
        }
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
