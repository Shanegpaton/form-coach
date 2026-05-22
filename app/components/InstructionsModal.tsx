'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';

const cameraSetup = [
  'Set the camera at about waist height and frame your full body from head to feet, leaving extra space for your hands at the top of your swing.',
  'Stand with your side facing the camera for a down-the-line view of your swing',
];

const steps = [
  'Allow camera access when prompted.',
  'Set up the camera as above, then tap Arm recording and get into frame.',
  'Hold still, then swing once you turn green.',
  'Replay your captured swing beside a professional driver reference and scrub frame by frame.',
  'Optional: run Coach with AI for written feedback on your last capture.',
];

const focusClass =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:focus-visible:outline-zinc-200';

export function InstructionsModal() {
  const [isOpen, setIsOpen] = useState(false);
  const openButtonRef = useRef<HTMLButtonElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('keydown', onKeyDown);
    const openButton = openButtonRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      openButton?.focus();
    };
  }, [isOpen]);

  return (
    <>
      <button
        ref={openButtonRef}
        type="button"
        aria-label="Open camera setup instructions"
        title="Camera setup instructions"
        className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-zinc-300 bg-white text-lg font-semibold text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800 ${focusClass}`}
        onClick={() => setIsOpen(true)}
      >
        ?
      </button>

      {isOpen ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-zinc-950/60 px-4 py-6 sm:items-center sm:py-8">
          <button
            type="button"
            aria-label="Close camera setup instructions"
            className="absolute inset-0 h-full w-full cursor-default"
            onClick={() => setIsOpen(false)}
          />
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="instructions-modal-heading"
            className="relative max-h-[calc(100vh-3rem)] w-full max-w-3xl overflow-y-auto rounded-lg border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950 sm:max-h-[calc(100vh-4rem)]"
          >
            <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-zinc-200 bg-white px-5 py-4 dark:border-zinc-800 dark:bg-zinc-950 sm:px-6">
              <div>
                <h2
                  id="instructions-modal-heading"
                  className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50"
                >
                  Camera setup
                </h2>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                  Match this setup before you arm recording.
                </p>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                aria-label="Close camera setup instructions"
                className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-300 bg-white text-sm font-semibold text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800 ${focusClass}`}
                onClick={() => setIsOpen(false)}
              >
                X
              </button>
            </div>

            <div className="space-y-6 px-5 py-5 sm:px-6">
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Setup checklist
                </h3>
                <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
                  {cameraSetup.map((text) => (
                    <li key={text}>{text}</li>
                  ))}
                </ul>
              </div>

              <figure className="flex flex-col items-center">
                <Image
                  src="/setup.png"
                  alt="Waist-height camera, full body in frame, golfer side-on for a down-the-line view."
                  width={1536}
                  height={1024}
                  sizes="(min-width: 768px) 672px, calc(100vw - 2.5rem)"
                  className="block max-h-[42vh] w-auto max-w-full rounded-lg border border-zinc-200 object-contain dark:border-zinc-700"
                />
              </figure>

              <div>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  How it works
                </h3>
                <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
                  {steps.map((text) => (
                    <li key={text}>{text}</li>
                  ))}
                </ol>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
