import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import SignUpForm from "./SignUpForm";

/**
 * If the user is already signed in, send them to the dashboard instead of
 * letting them create another account.
 */
export default async function Page() {
  const session = await auth();
  if (session) {
    redirect("/dashboard");
  }
  return <SignUpForm />;
}
