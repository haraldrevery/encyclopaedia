/**
 * testreport.js — read back what `npm test` left behind.
 *
 * The status page reports on the content; this reports on the generator that
 * built it. The build cannot run the suite itself: the standalone binary ships
 * without Node, and a build that shelled out to a test runner would no longer
 * be reproducible. So `npm test` writes test/results.json and this reads it.
 *
 * Nothing here throws. A missing, unreadable or malformed file reads as
 * "not run", which is exactly what it means to the person looking at the page.
 *
 * Results go stale the moment lib/ changes, and a green tick from before the
 * last edit is worse than no tick at all — so the newest mtime under lib/ and
 * test/ is compared against the run, and a later edit marks the run stale.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const RESULTS = path.join(ROOT, "test", "results.json");
const WATCHED = [path.join(ROOT, "lib"), path.join(ROOT, "test")];

const MISSING = { state: "missing", ok: false, pass: 0, fail: 0, total: 0, failures: [], when: null };

/** Newest mtime among the sources a test run is meant to cover, or 0. */
function newestSourceMtime() {
  let newest = 0;
  for (const dir of WATCHED) {
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.endsWith(".js") && !name.endsWith(".mjs")) continue;
      try {
        const { mtimeMs } = fs.statSync(path.join(dir, name));
        if (mtimeMs > newest) newest = mtimeMs;
      } catch {
        // A file that vanished between readdir and stat is not a test result.
      }
    }
  }
  return newest;
}

function readTestReport() {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(RESULTS, "utf8"));
  } catch {
    return MISSING;
  }
  if (!parsed || typeof parsed !== "object") return MISSING;

  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const when = typeof parsed.when === "string" ? parsed.when : null;
  const ranAt = when ? Date.parse(when) : NaN;
  const stale = Number.isFinite(ranAt) && ranAt < newestSourceMtime();

  const failures = Array.isArray(parsed.failures)
    ? parsed.failures.slice(0, 20).map((f) => ({
        name: String((f && f.name) || "unknown"),
        file: String((f && f.file) || ""),
        message: String((f && f.message) || "failed"),
      }))
    : [];

  return {
    // "stale" outranks "pass": the run no longer describes the current code.
    state: num(parsed.fail) > 0 ? "fail" : stale ? "stale" : "pass",
    ok: num(parsed.fail) === 0 && !stale,
    pass: num(parsed.pass),
    fail: num(parsed.fail),
    total: num(parsed.total),
    files: Array.isArray(parsed.files) ? parsed.files.map(String) : [],
    failures,
    when,
  };
}

module.exports = { readTestReport, RESULTS };
