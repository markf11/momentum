import { PasswordResetForm } from "@/components/auth/PasswordResetForm";

export const metadata = {
  title: "Reset Password | Momentum",
  description: "Reset your Momentum account password",
};

export default function ResetPasswordPage() {
  return (
    <div className="container flex h-screen w-screen flex-col items-center justify-center">
      <PasswordResetForm />
    </div>
  );
}
