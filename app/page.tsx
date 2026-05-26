/**
 * Root route.
 *
 * For unauthenticated visitors this is the marketing landing page (sign in /
 * sign up CTAs). For signed-in users we treat `/dashboard` as the real
 * homepage and redirect there server-side, so any "Home" link inside the app
 * — and the user's own bookmarks — always lands on the dashboard, not the
 * marketing site.
 */
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import HomeLanding from "./HomeLanding";

export default async function Page() {
  const session = await auth();
  if (session) {
    redirect("/dashboard");
  }
  return <HomeLanding />;
}
