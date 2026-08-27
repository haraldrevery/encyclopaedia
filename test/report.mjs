/**
 * report.mjs — run the suite and leave a machine-readable summary behind.
 *
 * `node --test` already prints a good report for a person. This wrapper exists
 * so the status page can show whether the tests pass without running them: the
 * build must not depend on Node (the standalone binary ships without it), so
 * results are written here and read back by lib/testreport.js.
 *
 * Exit code matches the suite, so it still works as a gate.
 */
import { run } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".test.js"))
  .sort()
  .map((f) => path.join(dir, f));

const failures = [];
let pass = 0;
let fail = 0;

// isolation:"none" runs every file in this process, which is what makes the
// stream report each individual test. The default spawns one subprocess per
// file and reports only the file's overall result — too coarse to list what
// actually broke. These are pure-function tests, so sharing a process is safe.
const stream = run({ files, isolation: "none" });

// Suites re-report the result of the tests inside them; counting those too
// would report every test twice.
const isSuite = (data) => Boolean(data && data.details && data.details.type === "suite");

stream.on("test:pass", (data) => {
  if (!isSuite(data)) pass += 1;
});
stream.on("test:fail", (data) => {
  if (isSuite(data)) return;
  fail += 1;
  const error = data && data.details && data.details.error;
  failures.push({
    name: (data && data.name) || "unknown",
    file: path.relative(process.cwd(), (data && data.file) || ""),
    message: String((error && error.message) || "failed").split("\n")[0],
  });
});

stream.on("end", () => {
  const summary = {
    when: new Date().toISOString(),
    files: files.map((f) => path.relative(process.cwd(), f)),
    total: pass + fail,
    pass,
    fail,
    ok: fail === 0,
    failures,
  };
  fs.writeFileSync(path.join(dir, "results.json"), `${JSON.stringify(summary, null, 2)}\n`);

  process.stdout.write(
    `\n${summary.ok ? "PASS" : "FAIL"}  ${pass}/${summary.total} tests in ${files.length} files\n`,
  );
  for (const f of failures) process.stdout.write(`  x ${f.name} — ${f.message}\n`);
  process.exitCode = summary.ok ? 0 : 1;
});

stream.resume();
