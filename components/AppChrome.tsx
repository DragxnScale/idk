"use client";

import { ClientErrorReporter } from "@/components/ClientErrorReporter";
import { ImpersonationBanner } from "@/components/ImpersonationBanner";

export function AppChrome() {
  return (
    <>
      <ClientErrorReporter />
      <ImpersonationBanner />
    </>
  );
}
