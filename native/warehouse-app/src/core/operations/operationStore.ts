export type OperationStatus =
  'queued' | 'sending' | 'uncertain' | 'confirmed' | 'rejected';
export interface OperationInput {
  id: string;
  scope: string;
  resource: string;
  method: string;
  path: string;
  bodyJson: string;
  createdAt: number;
}
export interface StoredOperation extends OperationInput {
  ownerId?: string;
  leaseExpiresAt?: number;
  status: OperationStatus;
  attempts: number;
  result?: unknown;
  errorCode?: string;
}
const unresolved = (o: StoredOperation) =>
  !['confirmed', 'rejected'].includes(o.status);

export class WorkBlockedError extends Error {
  constructor() {
    super('처리 여부를 먼저 확인해 주세요.');
  }
}
export function createOperationStore(name = 'almondwms-work-v2') {
  let opening: Promise<IDBDatabase> | undefined;
  const open = () =>
    (opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('operations', { keyPath: 'id' });
        req.result.createObjectStore('drafts', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
  async function transaction<T>(
    mode: IDBTransactionMode,
    action: (store: IDBObjectStore, done: (value: T) => void) => void
  ): Promise<T> {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction('operations', mode);
      let result: T;
      let failure: unknown;
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(failure ?? tx.error);
      tx.onabort = () => reject(failure ?? tx.error);
      try {
        action(tx.objectStore('operations'), (value) => {
          result = value;
        });
      } catch (error) {
        failure = error;
        tx.abort();
      }
    });
  }
  async function begin(input: OperationInput): Promise<StoredOperation> {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('operations', 'readwrite');
      const store = tx.objectStore('operations');
      let result: StoredOperation;
      let failure: unknown;
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(failure ?? tx.error);
      tx.onerror = () => reject(failure ?? tx.error);
      const req = store.getAll();
      req.onsuccess = () => {
        const all = req.result as StoredOperation[];
        const previous = all.find((o) => o.id === input.id);
        if (previous) {
          if (
            previous.scope !== input.scope ||
            previous.path !== input.path ||
            previous.method !== input.method ||
            previous.bodyJson !== input.bodyJson
          ) {
            failure = new WorkBlockedError();
            tx.abort();
            return;
          }
          result = previous;
          return;
        }
        if (
          all.some(
            (o) =>
              o.scope === input.scope &&
              o.resource === input.resource &&
              unresolved(o)
          )
        ) {
          failure = new WorkBlockedError();
          tx.abort();
          return;
        }
        result = { ...input, status: 'queued', attempts: 0 };
        store.add(result);
      };
    });
  }
  const get = (id: string) =>
    transaction<StoredOperation | null>('readonly', (s, done) => {
      const r = s.get(id);
      r.onsuccess = () => done(r.result ?? null);
    });
  const pending = (scope: string) =>
    transaction<StoredOperation[]>('readonly', (s, done) => {
      const r = s.getAll();
      r.onsuccess = () =>
        done(
          (r.result as StoredOperation[])
            .filter((o) => o.scope === scope && unresolved(o))
            .sort((a, b) => a.createdAt - b.createdAt)
        );
    });
  const confirmedForResource = (scope: string, resource: string) =>
    transaction<StoredOperation[]>('readonly', (s, done) => {
      const r = s.getAll();
      r.onsuccess = () =>
        done(
          (r.result as StoredOperation[]).filter(
            (o) =>
              o.scope === scope &&
              o.resource === resource &&
              o.status === 'confirmed'
          )
        );
    });
  const finish = (
    id: string,
    status: OperationStatus,
    result?: unknown,
    errorCode?: string
  ) =>
    transaction<void>('readwrite', (s, done) => {
      const r = s.get(id);
      r.onsuccess = () => {
        if (r.result && !['confirmed', 'rejected'].includes(r.result.status))
          s.put({
            ...r.result,
            status,
            result,
            errorCode,
            attempts: r.result.attempts + (status === 'sending' ? 1 : 0),
          });
        done();
      };
    });
  async function draft<T>(
    id: string,
    update?: (previous: T | undefined) => T
  ): Promise<T | undefined> {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('drafts', update ? 'readwrite' : 'readonly');
      const store = tx.objectStore('drafts');
      let value: T | undefined;
      tx.oncomplete = () => resolve(value);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
      const request = store.get(id);
      request.onsuccess = () => {
        value = request.result?.value;
        if (update) {
          value = update(value);
          store.put({ id, value });
        }
      };
    });
  }
  const claim = (
    id: string,
    scope: string,
    ownerId: string,
    now = Date.now()
  ) =>
    transaction<boolean>('readwrite', (s, done) => {
      const r = s.get(id);
      r.onsuccess = () => {
        const op = r.result as StoredOperation | undefined;
        if (
          !op ||
          op.scope !== scope ||
          !unresolved(op) ||
          (op.ownerId !== ownerId && (op.leaseExpiresAt ?? 0) > now)
        ) {
          done(false);
          return;
        }
        s.put({ ...op, ownerId, leaseExpiresAt: now + 20000 });
        done(true);
      };
    });
  const release = (id: string, ownerId: string) =>
    transaction<void>('readwrite', (s, done) => {
      const r = s.get(id);
      r.onsuccess = () => {
        if (r.result?.ownerId === ownerId)
          s.put({ ...r.result, leaseExpiresAt: 0 });
        done();
      };
    });
  return {
    begin,
    get,
    pending,
    confirmedForResource,
    finish,
    draft,
    claim,
    release,
  };
}
export type OperationStore = ReturnType<typeof createOperationStore>;
