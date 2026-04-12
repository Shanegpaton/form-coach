import Link from "next/link";
import DriverBenchmarkRunner from "./DriverBenchmarkRunner";

export default function DriverBenchmarksPage() {
  return (
    <>
      <header className="border-b border-zinc-200 bg-white px-4 py-6 dark:border-zinc-800 dark:bg-zinc-900/80 sm:px-6">
        <div className="mx-auto max-w-4xl">
          <Link
            prefetch={false}
            href="/"
            className="text-sm text-zinc-600 underline decoration-zinc-300 underline-offset-2 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:decoration-zinc-600 dark:hover:text-zinc-100"
          >
            Back to home
          </Link>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Driver swing benchmarks (dev)
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            Auto-runs on load; copy JSON from the panel below. Remove this route when you no longer
            need it.
          </p>
        </div>
      </header>
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
        <DriverBenchmarkRunner />
      </div>
    </>
  );
}
