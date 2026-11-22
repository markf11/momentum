export const getTitleFromPathname = (pathname: string) => {
  switch (pathname) {
    case "/calendar":
      return "Calendar | Momentum";
    case "/tasks":
      return "Tasks | Momentum";
    case "/focus":
      return "Focus | Momentum";
    case "/settings":
      return "Settings | Momentum";
    case "/setup":
      return "Setup | Momentum";
    case "/auth/signin":
      return "Sign In | Momentum";
    case "/auth/signup":
      return "Sign Up | Momentum";
    case "/auth/reset-password":
      return "Reset Password | Momentum";
    default:
      return "Momentum";
  }
};
