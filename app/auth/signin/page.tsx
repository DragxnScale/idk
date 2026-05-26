import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import SignInForm from "./SignInForm";

/**
 * If the user is already signed in, the dashboard is their homepage —
 * skip the sign-in form entirely. Otherwise show the credential form.
 */
export default async function Page() {
  const session = await auth();
  if (session) {
    redirect("/dashboard");
  }
  return <SignInForm />;
}
