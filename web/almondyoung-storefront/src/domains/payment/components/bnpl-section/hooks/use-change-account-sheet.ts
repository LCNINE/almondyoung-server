import { create } from "zustand"

interface ChangeAccountSheetStore {
  isOpen: boolean
  openSheet: () => void
  closeSheet: () => void
  toggleSheet: () => void
}

export const useChangeAccountSheet = create<ChangeAccountSheetStore>((set) => ({
  isOpen: false,
  openSheet: () => set({ isOpen: true }),
  closeSheet: () => set({ isOpen: false }),
  toggleSheet: () => set((state) => ({ isOpen: !state.isOpen })),
}))
