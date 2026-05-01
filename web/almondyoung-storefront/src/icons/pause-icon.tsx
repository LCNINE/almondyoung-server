import React from "react"

interface PauseIconProps {
  className?: string
}

export const PauseIcon: React.FC<PauseIconProps> = ({ className }) => {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 22 22"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path
        d="M8.63281 2.65625C8.63281 2.2895 8.3355 1.99219 7.96875 1.99219C7.602 1.99219 7.30469 2.2895 7.30469 2.65625V18.5938C7.30469 18.9605 7.602 19.2578 7.96875 19.2578C8.3355 19.2578 8.63281 18.9605 8.63281 18.5938L8.63281 2.65625Z"
        fill="currentColor"
      />
      <path
        d="M13.9453 2.65625C13.9453 2.2895 13.648 1.99219 13.2812 1.99219C12.9145 1.99219 12.6172 2.2895 12.6172 2.65625L12.6172 18.5938C12.6172 18.9605 12.9145 19.2578 13.2813 19.2578C13.648 19.2578 13.9453 18.9605 13.9453 18.5938L13.9453 2.65625Z"
        fill="currentColor"
      />
    </svg>
  )
}
