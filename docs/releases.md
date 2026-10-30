# Releases

Releases live on [GitHub Releases](https://github.com/sglavoie/zoomflow/releases).
All workspace packages stay private; nothing is published to npm.

## Create a release

Install the project's Node and pnpm versions plus the [GitHub CLI](https://cli.github.com/),
then authenticate with `gh auth login`. From a clean `main` checkout:

```sh
pnpm release patch --dry-run
pnpm release patch
# Or: pnpm release minor / pnpm release major
```

With no argument, `pnpm release` makes a patch release. Starting from `0.0.0`,
use `minor` for `0.1.0` or `major` for `1.0.0`.

The command checks authentication, fetches origin's main and tags, and refuses a
dirty tree, a branch other than main, a main behind or diverged from origin, or an
existing version tag. It updates every workspace package's version, commits
`chore(release): vX.Y.Z`, creates an annotated tag, and pushes main and the tag
atomically to origin. Dry runs perform the read checks and fetch but do not write
version files, commits, tags, or remote refs.

The tag starts the **Release** workflow. It runs typecheck, lint, checksum checks,
unit and CLI integration tests, builds the archives, tests the extracted CLI, and
runs production browser smoke tests. After those pass, it uploads the assets to a
draft GitHub Release and publishes it with generated release notes. The command
waits for the workflow and prints the release URL.

Version files are the only files in the release commit; `workspace:*` references
and the lockfile need no version changes. The existing main push still deploys
GitHub Pages independently.

## Retry an interrupted release

Fix the failure, keep the version commit and tag, and run:

```sh
pnpm release resume
```

Resume pushes any missing refs and reruns failed workflow jobs without bumping
again. It requires the original release commit at HEAD on main. If committing
failed, commit the version files with `chore(release): vX.Y.Z` first. If the fix
requires source changes, make a new release with a new version instead of moving
the existing tag. A release that is already published is left as it is.

## Downloads

Each release includes two platform-independent archives and `SHA256SUMS`:

- `zoomflow-cli-vX.Y.Z.tar.gz`: the built CLI, patched D2 WASM package and worker,
  fonts, standard library and dependency notices. Requires Node.js 26 or later;
  no pnpm or dependency installation is needed. Native D2 v0.9.0 on PATH is still
  required for exports. Lint uses the bundled WASM compiler.
- `zoomflow-web-vX.Y.Z.tar.gz`: the static production app, font and dependency
  notices, and patched compiler provenance. Serve the extracted directory with a
  static HTTP server; Ask AI requires the development server.

For example, after downloading the CLI archive and checksum file:

```sh
shasum -a 256 zoomflow-cli-vX.Y.Z.tar.gz
# Compare the printed hash with this archive's line in SHA256SUMS.
tar -xzf zoomflow-cli-vX.Y.Z.tar.gz
node zoomflow-cli-vX.Y.Z/packages/cli/bin/zoomflow.mjs --version
```

To make `zoomflow` available on PATH, symlink the extracted
`packages/cli/bin/zoomflow.mjs` into a directory such as `~/.local/bin`; keep the
rest of the extracted archive beside it.

## Verify packaging without publishing

```sh
pnpm release:build
pnpm release:smoke # also requires native D2 v0.9.0
```

Archives land in `dist/release/`. The smoke test extracts the CLI outside the
checkout and checks its version, WASM lint, standard library, native HTML export
and bundled fonts. You can also run **Release → Run workflow** in GitHub Actions:
manual runs perform the same checks and upload a `release` workflow artifact
without creating a tag or GitHub Release.
