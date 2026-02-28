"use client";

import { useState, useCallback } from "react";

interface QuizQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

interface QuizViewProps {
  questions: QuizQuestion[];
  onComplete: (score: number, total: number) => void;
}

export function QuizView({ questions, onComplete }: QuizViewProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [score, setScore] = useState(0);
  const [finished, setFinished] = useState(false);

  const current = questions[currentIndex];

  const handleSelect = useCallback(
    (optionIndex: number) => {
      if (revealed) return;
      setSelectedAnswer(optionIndex);
      setRevealed(true);
      if (optionIndex === current.correctIndex) {
        setScore((s) => s + 1);
      }
    },
    [revealed, current]
  );

  const handleNext = useCallback(() => {
    if (currentIndex + 1 >= questions.length) {
      const finalScore = score;
      setFinished(true);
      onComplete(finalScore, questions.length);
    } else {
      setCurrentIndex((i) => i + 1);
      setSelectedAnswer(null);
      setRevealed(false);
    }
  }, [currentIndex, questions.length, score, onComplete]);

  if (finished) {
    const pct = Math.round((score / questions.length) * 100);
    return (
      <div className="text-center py-10 space-y-4">
        <p className="text-5xl font-bold">{pct}%</p>
        <p className="text-lg text-gray-600 dark:text-gray-400">
          You got <strong>{score}</strong> out of <strong>{questions.length}</strong> correct
        </p>
        <p className="text-sm text-gray-500">
          {pct >= 80
            ? "Great job! You have a strong understanding of this material."
            : pct >= 50
            ? "Good effort! Review the concepts below to strengthen your understanding."
            : "Keep studying! The review material below will help you improve."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between text-sm text-gray-500 dark:text-gray-400">
        <span>
          Question {currentIndex + 1} of {questions.length}
        </span>
        <span>{score} correct so far</span>
      </div>

      <h3 className="text-lg font-medium leading-snug">{current.question}</h3>

      <div className="space-y-2">
        {current.options.map((option, i) => {
          let style = "border-gray-300 dark:border-gray-600 hover:border-gray-400";
          if (revealed) {
            if (i === current.correctIndex) {
              style = "border-green-500 bg-green-50 dark:border-green-600 dark:bg-green-900/20";
            } else if (i === selectedAnswer && i !== current.correctIndex) {
              style = "border-red-500 bg-red-50 dark:border-red-600 dark:bg-red-900/20";
            } else {
              style = "border-gray-200 opacity-50 dark:border-gray-700";
            }
          } else if (i === selectedAnswer) {
            style = "border-blue-500 bg-blue-50 dark:border-blue-500 dark:bg-blue-900/20";
          }

          return (
            <button
              key={i}
              onClick={() => handleSelect(i)}
              disabled={revealed}
              className={`w-full rounded-lg border p-3 text-left text-sm transition ${style}`}
            >
              <span className="font-medium mr-2">
                {String.fromCharCode(65 + i)}.
              </span>
              {option}
            </button>
          );
        })}
      </div>

      {revealed && (
        <div className="rounded-lg bg-gray-50 p-4 text-sm dark:bg-gray-800/50">
          <p className="font-medium mb-1">
            {selectedAnswer === current.correctIndex ? "Correct!" : "Incorrect"}
          </p>
          <p className="text-gray-600 dark:text-gray-400">{current.explanation}</p>
        </div>
      )}

      {revealed && (
        <button
          onClick={handleNext}
          className="w-full rounded-lg bg-black px-4 py-2.5 text-sm font-medium text-white dark:bg-white dark:text-black"
        >
          {currentIndex + 1 >= questions.length ? "See results" : "Next question"}
        </button>
      )}
    </div>
  );
}
