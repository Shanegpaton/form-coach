import CameraStream from "./components/cameraStream";
import { InstructionsModal } from "./components/InstructionsModal";

export default function Home() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:py-14">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div className="max-w-2xl">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-4xl">
            Computer vision coaching
          </h1>
          <p className="mt-3 text-base leading-relaxed text-zinc-600 dark:text-zinc-400">
            Use your webcam and pose tracking to capture a driver or 7-iron swing and review
            what was measured. Results match the training data best when your camera
            matches the recommended setup.
          </p>
        </div>
        <InstructionsModal />
      </header>
      <CameraStream />
    </main>
  );
}
