import Link from "next/link";
import CameraStream from "./components/cameraStream";

export default function Home() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex min-h-screen w-full max-w-3xl flex-col items-center justify-between py-32 px-16 bg-white dark:bg-black sm:items-start">
        <div className="flex flex-col items-center gap-6 text-center sm:items-start sm:text-left">
          <h1 className="text-4xl font-bold">Computer Vision Coaching</h1>
          <p>Start squating to get feedback on your form.</p>
          <p className="text-sm text-zinc-500">
            <Link prefetch={false} href="/dev/driver-benchmarks" className="text-blue-600 hover:underline">
              Dev: driver benchmark JSON
            </Link>
          </p>
          <CameraStream />
        </div>
      </main>
    </div>
  );
}
