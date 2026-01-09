import { create } from "zustand"

interface SearchSheetStore {
  isOpen: boolean
  onOpen: () => void
  onClose: () => void
}

export const useSearchSheetStore = create<SearchSheetStore>((set) => ({
  isOpen: false,
  onOpen: () => set({ isOpen: true }),
  onClose: () => set({ isOpen: false }),
}))
