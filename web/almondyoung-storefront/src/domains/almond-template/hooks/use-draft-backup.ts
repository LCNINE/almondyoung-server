import { useEffect, useRef, useState } from "react"
import {
  clearBackup,
  readBackup,
  writeBackup,
  type DraftBackup,
} from "../lib/draft-backup"
import { parseDesign, type Design } from "../lib/document"

const SAVE_DELAY_MS = 1500

type Params = {
  backupKey: string
  design: Design
  change: (design: Design) => void
  setMessage: (message: string) => void
}

export function useDraftBackup({
  backupKey,
  design,
  change,
  setMessage,
}: Params) {
  const [ready, setReady] = useState(false)
  const [backupOffer, setBackupOffer] = useState<DraftBackup | null>(null)
  const latest = useRef(design)
  latest.current = design

  useEffect(() => {
    let cancelled = false
    setReady(false)
    setBackupOffer(null)
    readBackup(backupKey)
      .catch(() => undefined)
      .then((backup) => {
        if (cancelled) return
        if (
          backup &&
          JSON.stringify(backup.design) !== JSON.stringify(latest.current)
        )
          setBackupOffer(backup)
        setReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [backupKey])

  const autosave = ready && !backupOffer
  const flushBackup = () =>
    writeBackup(backupKey, latest.current).catch(() => undefined)

  useEffect(() => {
    if (!autosave) return
    const timer = setTimeout(flushBackup, SAVE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [autosave, design])

  useEffect(() => {
    if (!autosave) return
    const onHide = () => {
      if (document.visibilityState === "hidden") void flushBackup()
    }
    document.addEventListener("visibilitychange", onHide)
    window.addEventListener("pagehide", flushBackup)
    return () => {
      document.removeEventListener("visibilitychange", onHide)
      window.removeEventListener("pagehide", flushBackup)
    }
  }, [autosave, backupKey])

  const restoreBackup = () => {
    if (!backupOffer) return
    try {
      change(parseDesign(backupOffer.design))
      setMessage("브라우저에 보관된 작업을 복원했습니다.")
    } catch {
      setMessage("보관된 작업이 손상되어 복원하지 못했습니다.")
    }
    setBackupOffer(null)
  }
  const discardBackup = () => {
    setBackupOffer(null)
    void clearBackup(backupKey).catch(() => undefined)
  }
  const forgetBackup = () => clearBackup(backupKey).catch(() => undefined)

  return {
    backupOffer,
    restoreBackup,
    discardBackup,
    flushBackup,
    forgetBackup,
  }
}
