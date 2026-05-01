interface AlertIconProps extends React.SVGProps<SVGSVGElement> {
  size?: number | string
}

const AlertIcon: React.FC<AlertIconProps> = ({ size = 14, ...props }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M7 0C3.2 0 0 3.2 0 7C0 10.8 3.2 14 7 14C10.8 14 14 10.9 14 7C14 3.1 10.9 0 7 0ZM6.5 3H7.5V8H6.5V3ZM7 11.2C6.6 11.2 6.2 10.8 6.2 10.4C6.2 10 6.5 9.6 7 9.6C7.4 9.6 7.8 10 7.8 10.4C7.8 10.8 7.4 11.2 7 11.2Z"
        fill="currentColor"
      />
    </svg>
  )
}

export default AlertIcon
