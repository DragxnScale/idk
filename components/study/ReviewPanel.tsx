"use client";

interface ReviewData {
  keyConcepts: string[];
  thingsToReview: string[];
  videoSuggestions: { title: string; searchQuery: string }[];
}

interface ReviewPanelProps {
  review: ReviewData;
  score: number;
  totalQuestions: number;
}

export function ReviewPanel({ review, score, totalQuestions }: ReviewPanelProps) {
  const pct = Math.round((score / totalQuestions) * 100);

  return (
    <div className="space-y-8">
      {/* Score summary */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 text-center dark:border-gray-800 dark:bg-gray-900">
        <p className="text-4xl font-bold mb-2">{pct}%</p>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {score} / {totalQuestions} correct
        </p>
        <p className="text-xs text-gray-500 mt-2">
          {pct >= 80
            ? "Excellent work! You have a strong grasp of this material."
            : pct >= 50
            ? "Good effort! Review the concepts below to strengthen your understanding."
            : "Keep studying! The material below will help you improve."}
        </p>
      </div>

      {/* Key concepts */}
      <section>
        <h3 className="text-base font-semibold mb-3">Key Concepts</h3>
        <ul className="space-y-2">
          {review.keyConcepts.map((concept, i) => (
            <li
              key={i}
              className="flex gap-2 rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-700"
            >
              <span className="text-blue-500 font-bold flex-shrink-0">•</span>
              <span>{concept}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Things to review */}
      <section>
        <h3 className="text-base font-semibold mb-3">Things to Review</h3>
        <ul className="space-y-2">
          {review.thingsToReview.map((item, i) => (
            <li
              key={i}
              className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-900/20"
            >
              <span className="text-amber-500 font-bold flex-shrink-0">!</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Video suggestions */}
      <section>
        <h3 className="text-base font-semibold mb-3">Suggested Videos</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {review.videoSuggestions.map((video, i) => (
            <a
              key={i}
              href={`https://www.youtube.com/results?search_query=${encodeURIComponent(
                video.searchQuery
              )}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-start gap-3 rounded-lg border border-gray-200 p-3 transition hover:border-red-400 hover:shadow-sm dark:border-gray-700"
            >
              <span className="text-red-500 text-lg flex-shrink-0">▶</span>
              <div>
                <p className="text-sm font-medium">{video.title}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  Search YouTube
                </p>
              </div>
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}
