# Repository instructions

## Language and documentation

- Use English.
- Keep documentation concise and maintain it only in code comments or these root
  files: `README.md` (usage), `GLOSSARY.md` (terms), `RENDERING.md` (rendering design),
  and `AGENTS.md` (instructions and workflows). Do not create a `docs/` directory
  or additional documentation files.
- `RENDERING.md` is the sole authoritative rendering design source. Read it before
  changing the pipeline and update it in the same change. Do not duplicate its
  design rules elsewhere.
- Keep development, testing, packaging, and release workflows here.

## Development and testing

- Requires Node.js 24+ and pnpm 12 (`corepack install --global pnpm@12.3.4`).
  Run `pnpm install`, then `pnpm dev` (`pnpm dev:wsl` for WSL).
- Prefer low-cost, targeted checks using existing tools and environments.
  `pnpm check` runs type checking and Node tests; use `node --test <test-file>`
  for focused coverage. Run only relevant Go tests with `go test ./desktop -run <pattern>`.
- Browser scripts are ad hoc local integration checks, not release gates. Never
  add them to release CI/CD or the default test/build commands.
- Run browser checks only when needed: start a Vite dev server, then use
  `pnpm test:browser <check-or-suite>`. `--list` shows choices; no arguments runs
  smoke. Select the smallest scope. Each check times out after 180 seconds.
- `PDF_TEST_URL` defaults to `http://127.0.0.1:5173`; static preview is insufficient
  because some checks import source modules. Font checks use `PDF_TEST_FONT` or
  the script's default system font.
- Reuse global Playwright at `/home/jay-waves/.local/lib/node_modules/playwright`
  and system Chrome via `chromium.launch({ channel: "chrome" })`. Do not add
  Playwright to the project. Do not download browsers or reinstall Playwright
  without user approval.
- For desktop draft integration, run
  `PDF_TS_BROWSER_TEST=1 go test ./desktop -run '^TestDraftBrowser$' -count=1`.
  Its browser subprocess uses temporary files; never invoke it on working PDFs.

## Tools and packaging

- Keep packaging/release tools in `scripts/`, manual browser integration scripts
  in `tests/browser/`, shared fixtures/helpers in `tests/support/`, and manual
  diagnostics in `tools/diagnostics/`. Reuse existing helpers before adding files.
- Diagnostics are not test gates. `PDF_BENCH_OUTPUT` saves rendering benchmark JSON;
  `check-static-memory.mjs` needs `node --expose-gc` for explicit GC. Review tools
  that inspect SDK internals after dependency upgrades.
- Run `pnpm compile`, then `pnpm package:chrome`, `pnpm package:linux`,
  `pnpm package:windows`, or `pnpm package:macos`. Native builds need Go;
  Linux packages need nFPM, Windows needs NSIS and rsrc, and macOS needs Apple
  Silicon and Xcode Command Line Tools.
- `node packaging/build.mjs <chrome|linux|windows|macos>` is the packaging entry.
  Append `deb`/`rpm` for one Linux package or `binary` for a native service only.
  Do not build the same output concurrently in one worktree.
- `scripts/release.sh` validates and pushes the branch/tag; release CI packages,
  verifies installers, and uploads via `scripts/publish-release.sh`.
  Keep browser integration checks local. Regenerate icons only when branding changes.
