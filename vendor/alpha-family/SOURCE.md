# Alpha family source provenance

This directory contains the selected **230-package runtime/profile closure**, not a second source build and not the complete 257-package pack output. The closure selection is recorded in [docs/p0-alpha-runtime-profile-closure.md](../../docs/p0-alpha-runtime-profile-closure.md).

## Fixed upstream basis

- Upstream: `deepseek-ai/deepseek-harness` commit `d347e703908d0406b7a7ef80e3a0e594d86b2215`.
- Applied fixed patch: [artifacts/architect-audit/alpha-reasoning/20260906T213310Z/alpha-reasoning.patch](../../artifacts/architect-audit/alpha-reasoning/20260906T213310Z/alpha-reasoning.patch), SHA-256 `c3e0b4a96e91c79ad49a13f7ddddcb4c7ab792cf419edca5d6db830612e4015c`.

## Verified build and pack evidence

The authoritative evidence is retained in the repository, rather than relying on a temporary build location:

- [preflight.txt](../../artifacts/architect-audit/alpha-patched-build/20260906T221101Z-official/preflight.txt), SHA-256 `a0832c4044d37d36f61e4a0f9d3e31b03e6dde3276fe4ac8e26c0425bbccb08c`
- [final-source-integrity.json](../../artifacts/architect-audit/alpha-patched-build/20260906T221101Z-official/final-source-integrity.json), SHA-256 `70ffbef5531d2eed5476386e377273d21823b96a916a09af639809a43b95c096`
- [root-packed-family-hashes.json](../../artifacts/architect-audit/alpha-patched-build/20260906T221101Z-official/root-packed-family-hashes.json), SHA-256 `649bbb6c0835432d1564ad75153595bfd108cce86523ca2cd8e05ac09e3ec545`, the complete 257-tarball manifest
- Exact recorded commands: [build-command-actual.txt](../../artifacts/architect-audit/alpha-patched-build/20260906T221101Z-official/build-command-actual.txt), [dsh-pack-command.txt](../../artifacts/architect-audit/alpha-patched-build/20260906T221101Z-official/dsh-pack-command.txt), and [vendor-pack-command.txt](../../artifacts/architect-audit/alpha-patched-build/20260906T221101Z-official/vendor-pack-command.txt).

## Reproduction route

Use a clean checkout at the fixed commit, apply the exact patch above, and use the recorded Node 22.22.2 / pnpm 11.7.0 environment. Run the recorded `pnpm run build:official`, then the recorded `pnpm run release:pack --family dsh` and `--family vendor` commands. Verify the full 257-tarball manifest before selecting the documented 230-package runtime/profile closure. Do not treat any `/private/tmp` output location as a source of truth.
