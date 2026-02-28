import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Nav */}
      <header className="border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link href="/" className="text-lg font-bold tracking-tight">
            Study Focus
          </Link>
          <nav className="flex items-center gap-3">
            <Link
              href="/auth/signin"
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              Sign in
            </Link>
            <Link
              href="/auth/signup"
              className="rounded-lg bg-black px-4 py-1.5 text-sm font-medium text-white dark:bg-white dark:text-black"
            >
              Get started
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-5xl px-6 py-20 md:py-28">
        <div className="max-w-2xl">
          <h1 className="text-4xl font-bold tracking-tight md:text-5xl">
            Study smarter,
            <br />
            stay focused.
          </h1>
          <p className="mt-5 text-lg text-gray-600 leading-relaxed dark:text-gray-400">
            Upload a PDF or pick a textbook, set your timer, and start reading.
            Study Focus keeps you on track with focus enforcement, AI-generated
            notes, end-of-session quizzes, and personalized review material.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/auth/signup"
              className="rounded-lg bg-black px-6 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-gray-800 dark:bg-white dark:text-black dark:hover:bg-gray-200"
            >
              Start studying free
            </Link>
            <Link
              href="/dashboard"
              className="rounded-lg border border-gray-300 px-6 py-3 text-sm font-medium transition hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
            >
              View dashboard
            </Link>
          </div>
        </div>
      </section>

      {/* Feature grid */}
      <section className="border-t border-gray-200 bg-white py-16 dark:border-gray-800 dark:bg-gray-900">
        <div className="mx-auto max-w-5xl px-6">
          <h2 className="text-2xl font-bold mb-10 text-center">
            Everything you need to study effectively
          </h2>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <FeatureCard
              icon="📖"
              title="In-app reading"
              description="Upload PDFs or browse our textbook catalog. Read right inside the app with a page-by-page viewer."
            />
            <FeatureCard
              icon="🎯"
              title="Focus enforcement"
              description="Timer pauses when you leave the tab. Fullscreen mode for distraction-free studying."
            />
            <FeatureCard
              icon="🤖"
              title="AI-powered notes"
              description="Generate study notes from the pages you read. Key concepts highlighted and organized automatically."
            />
            <FeatureCard
              icon="📝"
              title="Quizzes"
              description="End every session with an auto-generated quiz to test your understanding of the material."
            />
            <FeatureCard
              icon="📊"
              title="Progress tracking"
              description="Track your study time, sessions, and streaks. See your weekly activity at a glance."
            />
            <FeatureCard
              icon="🎬"
              title="Review & videos"
              description="Get personalized review material and curated video suggestions to reinforce your learning."
            />
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 px-6">
        <div className="mx-auto max-w-xl text-center">
          <h2 className="text-2xl font-bold mb-4">Ready to study?</h2>
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            Create a free account and start your first session in under a minute.
          </p>
          <Link
            href="/auth/signup"
            className="inline-block rounded-lg bg-black px-8 py-3 text-sm font-medium text-white shadow-sm dark:bg-white dark:text-black"
          >
            Get started
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-200 py-8 dark:border-gray-800">
        <div className="mx-auto max-w-5xl px-6 flex flex-wrap items-center justify-between gap-4 text-xs text-gray-500 dark:text-gray-400">
          <p>Study Focus</p>
          <div className="flex gap-4">
            <Link href="/dashboard" className="hover:underline">
              Dashboard
            </Link>
            <Link href="/study/session" className="hover:underline">
              Study
            </Link>
            <Link href="/study/history" className="hover:underline">
              History
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: string;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-xl border border-gray-200 p-6 dark:border-gray-800">
      <span className="text-2xl">{icon}</span>
      <h3 className="mt-3 text-sm font-semibold">{title}</h3>
      <p className="mt-1.5 text-sm text-gray-600 leading-relaxed dark:text-gray-400">
        {description}
      </p>
    </div>
  );
}
