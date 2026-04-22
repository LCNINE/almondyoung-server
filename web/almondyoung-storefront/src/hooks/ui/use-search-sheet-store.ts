import { create } from "zustand"

interface SearchSheetStore {
  isOpen: boolean
  onOpen: () => void
  onClose: () => void
  searchTerm: string
  setSearchTerm: (searchTerm: string) => void
}

export const useSearchSheetStore = create<SearchSheetStore>((set) => ({
  isOpen: false,
  onOpen: () => set({ isOpen: true }),
  onClose: () => set({ isOpen: false }),
  searchTerm: "",
  setSearchTerm: (searchTerm: string) => set({ searchTerm }),
}))
