import CameraStream from "./components/cameraStream";

const cameraSetup = [
  "Set the camera at about waist height and frame your full body from head to feet, leaving extra space for your hands at the top of your swing.",
  "Stand with your side facing the camera for a down-the-line view of your swing",
];

const steps = [
  "Allow camera access when prompted.",
  "Set up the camera as above, then tap Arm recording and get into frame.",
  "Hold still, then swing when the app tells you to.",
  "Optional: run Coach with AI for written feedback on your last capture.",
];

export default function Home() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:py-14">
      <header className="mb-8 max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-4xl">
          Computer vision coaching
        </h1>
        <p className="mt-3 text-base leading-relaxed text-zinc-600 dark:text-zinc-400">
          Use your webcam and pose tracking to capture a driver swing and review
          what was measured. Results match the training data best when your camera
          matches the setup below.
        </p>
      </header>

      <section
        className="mb-10 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900/40 sm:p-6"
        aria-labelledby="camera-setup-heading"
      >
        <h2
          id="camera-setup-heading"
          className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
        >
          Camera setup
        </h2>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
          {cameraSetup.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
        <figure className="mt-6 flex flex-col items-center">
          <img
            src="/setup.png"
            alt="Waist-height camera, full body in frame, golfer side-on for a down-the-line view."
            className="mx-auto block max-h-[min(55vh,560px)] w-auto max-w-full rounded-lg border border-zinc-200 object-contain dark:border-zinc-700 sm:max-w-2xl"
            loading="lazy"
          />
        </figure>
      </section>

      <section
        className="mb-10 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900/40 sm:p-6"
        aria-labelledby="how-it-works-heading"
      >
        <h2
          id="how-it-works-heading"
          className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
        >
          How it works
        </h2>
        <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
          {steps.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ol>
      </section>
      <CameraStream />
    </main>
  );
}
