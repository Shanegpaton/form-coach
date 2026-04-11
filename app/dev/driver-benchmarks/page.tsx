import Link from "next/link";
import DriverBenchmarkRunner from "./DriverBenchmarkRunner";

export default function DriverBenchmarksPage() {
  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <div className="mx-auto max-w-4xl border-b border-zinc-200 bg-white px-6 py-4">
        <Link prefetch={false} href="/" className="text-sm text-blue-600 hover:underline">
          ← Home
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Driver swing benchmarks (dev)</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Auto-runs on load; copy JSON from the panel below. Remove this route when you no longer need it.
        </p>
      </div>
      <DriverBenchmarkRunner />
    </div>
  );
}
