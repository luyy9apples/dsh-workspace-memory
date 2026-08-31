# Publishing checklist

`npm publish` changes the public registry and is intentionally not automated by the local build.

## Before the first release

1. Make <https://github.com/luyy9apples/dsh-workspace-memory> public and confirm that its Issues page is enabled. The `repository`, `homepage`, and `bugs` fields are already present in `package.json`.
2. Confirm the package name is still available:

   ```sh
   npm view dsh-workspace-memory version
   ```

   A `404 Not Found` means no public package currently owns the name; availability can still change before publication.
3. Review `LICENSE`, `SECURITY.md`, both READMEs, and the compatibility claims.
4. Run the release checks and inspect the exact tarball:

   ```sh
   pnpm install --frozen-lockfile
   pnpm run verify
   npm pack --dry-run
   npm pack
   ```
5. Install the generated tarball into a clean disposable DSH profile and verify `--dump-config`, startup, proposal acceptance, proposal rejection, and uninstall.

## Publish

Authenticate with the npm account that will own the unscoped package, then publish explicitly:

```sh
npm whoami
npm publish --access public
```

Tag the same commit as `v0.1.0`, create a GitHub Release from `CHANGELOG.md`, and add the repository topics `dsh-plugin`, `deepseek-harness`, `agent-memory`, `workspace-memory`, and `local-first`.

After publication, verify the public install path in a new profile:

```sh
dsh plugin --profile workspace-memory-smoke add dsh-workspace-memory@0.1.0
dsh --profile workspace-memory-smoke --dump-config
dsh plugin --profile workspace-memory-smoke remove dsh-workspace-memory
```
