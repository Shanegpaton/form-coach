/**
 * Starts Next dev server, opens /dev/driver-benchmarks in headless Chromium,
 * waits for batch pose + metrics, writes JSON under app/lib/swing/data/.
 *
 * Usage: node scripts/capture-driver-benchmarks.mjs
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MAC_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const port = process.env.BENCHMARK_PORT ?? "3999";
/** Use localhost so Playwright matches Next dev server origin (avoids extra noise). */
const base = `http://localhost:${port}`;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForServer(url, maxMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await sleep(500);
  }
  throw new Error(`Server not responding: ${url}`);
}

/** Avoid hitting `/` — that mounts the home page and requests the webcam in dev. */
function warmupUrl(base) {
  return `${base}/swings/Driver/billyDriver.mp4`;
}

async function main() {
  const child = spawn("npm", ["run", "dev", "--", "-p", port], {
    cwd: root,
    stdio: "pipe",
    shell: true,
    env: { ...process.env, PORT: port },
  });

  child.stderr?.on("data", (d) => process.stderr.write(d));
  child.stdout?.on("data", (d) => process.stdout.write(d));

  try {
    await waitForServer(warmupUrl(base));
    const useChrome = fs.existsSync(MAC_CHROME);
    const browser = await chromium.launch({
      executablePath: useChrome ? MAC_CHROME : undefined,
      headless: true,
      args: ["--headless=new", "--autoplay-policy=no-user-gesture-required"],
    });
    const page = await browser.newPage();
    page.setDefaultTimeout(900000);

    await page.goto(`${base}/dev/driver-benchmarks`, {
      waitUntil: "domcontentloaded",
      timeout: 120000,
    });

    await page.waitForFunction(
      () => {
        const el = document.querySelector("#driver-benchmark-status");
        return el?.getAttribute("data-status") === "done" || el?.getAttribute("data-status") === "error";
      },
      { timeout: 900000 },
    );

    const st = await page.locator("#driver-benchmark-status").getAttribute("data-status");
    const text = (await page.locator("#driver-benchmark-json").innerText()).trim();

    if (st === "error") {
      throw new Error(`Benchmark page reported error. Panel:\n${text.slice(0, 2000)}`);
    }
    if (!text || text === "…") {
      throw new Error("No JSON captured from #driver-benchmark-json");
    }

    const data = JSON.parse(text);
    const outDir = path.join(root, "app", "lib", "swing", "data");
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "driverProBenchmarks.full.json"), text, "utf8");

    const numericRanges = data.summary?.numericRanges ?? {};
    const bands = {};
    const padFraction = 0.08;
    for (const [key, v] of Object.entries(numericRanges)) {
      const span = v.max - v.min;
      const pad = Math.max(Math.abs(span) * padFraction, Math.abs(v.mean) * 0.02, 1e-6);
      bands[key] = {
        low: v.min - pad,
        high: v.max + pad,
        observedMin: v.min,
        observedMax: v.max,
      };
    }

    const compact = {
      club: "driver",
      sourceVideos: Object.keys(data.perSwing ?? {}),
      generatedAt: new Date().toISOString(),
      numericRanges,
      bands,
      bandsNote:
        "low/high widen each metric's observed min–max by ~8% of span (min 2% of |mean|) for coaching tolerance on small samples.",
      pathTypeCounts: data.summary?.pathTypeCounts ?? {},
    };
    fs.writeFileSync(path.join(outDir, "driverProRanges.json"), JSON.stringify(compact, null, 2), "utf8");

    console.log("Wrote app/lib/swing/data/driverProBenchmarks.full.json");
    console.log("Wrote app/lib/swing/data/driverProRanges.json");
    await browser.close();
  } finally {
    child.kill("SIGTERM");
    await sleep(2000);
    try {
      child.kill("SIGKILL");
    } catch {
      /* ignore */
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
