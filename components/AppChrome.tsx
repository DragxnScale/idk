"use client";

import { ClientErrorReporter } from "@/components/ClientErrorReporter";
import { ImpersonationBanner } from "@/components/ImpersonationBanner";
import { SplashScreen } from "@/components/SplashScreen";

export function AppChrome() {
  return (
    <>
      <SplashScreen />
      <ClientErrorReporter />
      <ImpersonationBanner />
    </>
  );
}
