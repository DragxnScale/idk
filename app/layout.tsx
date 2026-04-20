import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppChrome } from "@/components/AppChrome";

export const metadata: Metadata = {
  title: "Bowl Beacon",
  description:
    "Stay focused while studying. Set goals, read in-app, and get AI-powered notes and quizzes.",
  icons: {
    icon: "/favicon.png",
    apple: "/apple-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Bowl Beacon",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("bowlbeacon-theme");if(t&&t!=="default")document.documentElement.setAttribute("data-theme",t);if(t&&t.startsWith("custom-")){var ct=JSON.parse(localStorage.getItem("bowlbeacon-custom-themes")||"[]").find(function(c){return c.id===t});if(ct){var el=document.documentElement;el.style.setProperty("--theme-primary",ct.primary);el.style.setProperty("--theme-primary-fg",ct.primaryFg);el.style.setProperty("--theme-accent",ct.accent);el.style.setProperty("--background",ct.bg);el.style.setProperty("--foreground",ct.text)}}}catch(e){}`,
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `if("serviceWorker"in navigator){navigator.serviceWorker.register("/sw.js").then(function(r){r.addEventListener("updatefound",function(){var w=r.installing;if(w)w.addEventListener("statechange",function(){if(w.state==="installed"&&navigator.serviceWorker.controller){w.postMessage("skipWaiting");location.reload()}})});setInterval(function(){r.update()},60000);function sendLimits(sw){try{var c=Number(localStorage.getItem("bowlbeacon-pdf-cache-count"))||2;var mb=Number(localStorage.getItem("bowlbeacon-pdf-cache-mb"))||500;var en=localStorage.getItem("bowlbeacon-pdf-cache-enabled");sw.postMessage({type:"setPdfCacheLimits",maxCount:c,maxBytes:mb*1024*1024});sw.postMessage({type:"setPdfCacheEnabled",enabled:en!=="false"})}catch(e){}}navigator.serviceWorker.ready.then(function(reg){if(reg.active)sendLimits(reg.active)})}).catch(function(){})}`
          }}
        />
      </head>
      <body className="antialiased min-h-screen">
        <AppChrome />
        {children}
      </body>
    </html>
  );
}
