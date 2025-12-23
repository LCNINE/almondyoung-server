"use client"

import { Spinner } from "@components/common/spinner"

interface PinKeypadProps {
  shuffledNumbers: (number | string)[]
  handleNumberClick: (value: string | number) => void
  pin: string
  isPending: boolean
}

export default function PinKeypad({
  shuffledNumbers,
  handleNumberClick,
  pin,
  isPending,
}: PinKeypadProps) {
  return (
    <>
      <div className="my-4 grid grid-cols-3 gap-3 pb-4 sm:gap-4 sm:pb-6">
        {shuffledNumbers.map((num, index) => {
          if (num === "") {
            return <div key={index} />
          }

          if (num === "backspace") {
            return (
              <button
                type="button"
                key={index}
                onClick={() => handleNumberClick("backspace")}
                className="bg-gray-10 hover:bg-gray-20 flex h-14 items-center justify-center rounded-2xl font-medium text-gray-600 transition-all active:scale-95 active:bg-gray-100 disabled:opacity-50 sm:h-16"
                disabled={pin.length === 0 || isPending}
              >
                {isPending ? (
                  <Spinner size="sm" color="gray" />
                ) : (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5 sm:h-6 sm:w-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M3 12l6.414 6.414a2 2 0 001.414.586H19a2 2 0 002-2V7a2 2 0 00-2-2h-8.172a2 2 0 00-1.414.586L3 12z"
                  />
                </svg>
                )}
              </button>
            )
          }

          return (
            <button
              key={`${num}-${index}`}
              type="button"
              onClick={() => handleNumberClick(num)}
              className="bg-gray-10 flex h-14 items-center justify-center rounded-2xl text-xl font-semibold text-gray-900 transition-all hover:bg-gray-100 active:scale-95 active:bg-gray-200 sm:h-16 sm:text-2xl"
            >
              {num}
            </button>
          )
        })}
      </div>
    </>
  )
}
