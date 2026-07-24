import { createContext, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { localStoragePrefs, type DevicePrefs } from '../core/data/devicePrefs';

const STORAGE_KEY = 'almondwms.warehouse';

export interface SelectedWarehouse {
  id: string;
  name: string;
}

interface WarehouseContextValue {
  warehouseId: string | null;
  warehouseName: string | null;
  isSet: boolean;
  setWarehouse(w: SelectedWarehouse): void;
  clearWarehouse(): void;
}

const WarehouseContext = createContext<WarehouseContextValue | null>(null);

function readStored(prefs: DevicePrefs): SelectedWarehouse | null {
  const raw = prefs.get(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'id' in parsed &&
      'name' in parsed &&
      typeof parsed.id === 'string' &&
      typeof parsed.name === 'string'
    ) {
      return { id: parsed.id, name: parsed.name };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 현장 PDA 는 한 창고에 고정된다. 백엔드에 사용자↔창고 바인딩이 없으므로
 * 기기 로컬에 저장하고 조정·실사·위치조회가 이 값을 warehouseId 로 쓴다.
 */
export function WarehouseProvider({
  prefs = localStoragePrefs,
  children,
}: {
  prefs?: DevicePrefs;
  children: ReactNode;
}) {
  const [selected, setSelected] = useState<SelectedWarehouse | null>(() =>
    readStored(prefs)
  );

  const value = useMemo<WarehouseContextValue>(
    () => ({
      warehouseId: selected?.id ?? null,
      warehouseName: selected?.name ?? null,
      isSet: selected !== null,
      setWarehouse(w) {
        prefs.set(STORAGE_KEY, JSON.stringify({ id: w.id, name: w.name }));
        setSelected({ id: w.id, name: w.name });
      },
      clearWarehouse() {
        prefs.remove(STORAGE_KEY);
        setSelected(null);
      },
    }),
    [selected, prefs]
  );

  return (
    <WarehouseContext.Provider value={value}>
      {children}
    </WarehouseContext.Provider>
  );
}

export function useWarehouse(): WarehouseContextValue {
  const ctx = useContext(WarehouseContext);
  if (!ctx)
    throw new Error('useWarehouse must be used within a WarehouseProvider');
  return ctx;
}
