# R3.2 Static Migration Baseline

- Status: `CONFIG_STUDIO_R3.2_STATIC_IN_PROGRESS`
- Frozen date: `2026-07-30`
- Git branch: `main`
- Git commit: `1e2f67517c3dd2c1aed4530c9734b47af88b7008`
- Git tree: `2be138742f882899dce5874513496c41870ae981`
- Remote: `mahochyan/mahochyan33-F28034_CubeMX`
- Previous Pages source: `main:/docs`

The baseline is recoverable from the immutable Git commit above. R3.2 changes
must not rewrite that commit. The previous Pages site was a static project
landing page; the configurator itself still depended on Flask `/api` routes and
therefore did not satisfy the R3.2 production-runtime requirement.
