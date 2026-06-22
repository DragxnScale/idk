import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { UiEditShell } from "@/components/ui-edit/UiEditShell";

export const dynamic = "force-dynamic";

export default async function UiEditPage() {
  const session = await requireAdmin();
  if (!session) {
    redirect("/admin");
  }
  return <UiEditShell />;
}
