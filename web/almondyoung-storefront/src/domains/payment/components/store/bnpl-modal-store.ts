import { create } from "zustand"

interface BnplModalStore {
  isOpen: boolean
  openModal: () => void
  closeModal: () => void
  toggleModal: () => void
}

export const useBnplModalStore = create<BnplModalStore>((set) => ({
  isOpen: false,
  openModal: () => set({ isOpen: true }),
  closeModal: () => set({ isOpen: false }),
  toggleModal: () => set((state) => ({ isOpen: !state.isOpen })),
}))
