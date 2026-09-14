# V1 audit-only compatibility check

Only two cross-package audit tests changed in the v1 adapter. Its runtime remains
unchanged and its SDK retains Effect beta.83 separately from native v2 rc.112.

The first smoke attempt used the machine's generic `opencode` command and failed
the legacy health/doc endpoints. The isolated check instead pins the actual v1
CLI to 1.18.22 in a temporary package outside all global configuration stores.

Run the adjacent script from the task worktree with `QA_V1_BIN_DIR` pointing to
that temporary package's `node_modules/.bin`. `smoke.log` captures real health,
OpenAPI and unauthenticated-access behavior. `isolation.txt` records the real
session count before/after. No credentials or host configuration are recorded.
