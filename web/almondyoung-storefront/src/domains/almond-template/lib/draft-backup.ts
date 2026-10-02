const DB_NAME = "almond-template"
const STORE = "backups"
const TTL_MS = 7 * 24 * 60 * 60 * 1000

export type DraftBackup = { design: unknown; savedAt: number }

let database: Promise<IDBDatabase> | undefined

function db() {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  return database
}

async function run<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>
) {
  const store = (await db()).transaction(STORE, mode).objectStore(STORE)
  return new Promise<T>((resolve, reject) => {
    const request = action(store)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function readBackup(key: string) {
  const backup = await run<DraftBackup | undefined>("readonly", (store) =>
    store.get(key)
  )
  if (backup && Date.now() - backup.savedAt > TTL_MS) {
    await clearBackup(key)
    return undefined
  }
  return backup
}

export const writeBackup = (key: string, design: unknown) =>
  run("readwrite", (store) =>
    store.put({ design, savedAt: Date.now() } satisfies DraftBackup, key)
  )

export const clearBackup = (key: string) =>
  run("readwrite", (store) => store.delete(key))

export async function clearAllBackups() {
  const opened = database
  database = undefined
  ;(await opened?.catch(() => undefined))?.close()
  indexedDB.deleteDatabase(DB_NAME)
}
