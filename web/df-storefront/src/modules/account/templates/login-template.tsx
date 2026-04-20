import Login from "@modules/account/components/login"

export enum LOGIN_VIEW {
  SIGN_IN = "sign-in",
  REGISTER = "register",
}

const LoginTemplate = () => {
  return (
    <div className="w-full flex justify-start px-8 py-8">
      <Login />
    </div>
  )
}

export default LoginTemplate
