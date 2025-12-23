import { create } from "zustand"

interface SecuritySheetStore {
  isOpen: boolean
  openSheet: () => void
  closeSheet: () => void
  toggleSheet: () => void
}

export const useSecuritySheetStore = create<SecuritySheetStore>((set) => ({
  isOpen: false,
  openSheet: () => set({ isOpen: true }),
  closeSheet: () => set({ isOpen: false }),
  toggleSheet: () => set((state) => ({ isOpen: !state.isOpen })),
}))
