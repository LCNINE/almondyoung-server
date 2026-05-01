import { useState, useEffect } from "react"

export function usePinKeypad(useRandom: boolean = true) {
  const [shuffledNumbers, setShuffledNumbers] = useState<(number | string)[]>(
    []
  )

  const shuffleKeypad = () => {
    if (useRandom) {
      const numbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0]
      const shuffled = [...numbers].sort(() => Math.random() - 0.5)
      const grid = [...shuffled.slice(0, 9), "", shuffled[9], "backspace"]
      setShuffledNumbers(grid)
    } else {
      setShuffledNumbers([1, 2, 3, 4, 5, 6, 7, 8, 9, "", 0, "backspace"])
    }
  }

  useEffect(() => {
    shuffleKeypad()
  }, [])

  return { shuffledNumbers, shuffleKeypad }
}
