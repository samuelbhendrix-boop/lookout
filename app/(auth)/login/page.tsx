import { Suspense } from "react";
import { AuthForm } from "@/components/AuthForm";
import { ssoConfig } from "@/lib/sso";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  const sso = ssoConfig();
  return (
    <Suspense>
      <AuthForm mode="login" ssoLabel={sso?.label} />
    </Suspense>
  );
}
