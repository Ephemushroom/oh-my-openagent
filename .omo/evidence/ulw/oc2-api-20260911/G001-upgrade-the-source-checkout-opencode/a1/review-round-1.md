# Gate review: REJECT

Oracle identified three blocking gaps after reviewing source and raw evidence:

1. Production runOpenCode2Installer used a second resolver returning index.ts, while the QA helper called only the corrected walk-up resolver. Wire the actual installer and test missing source before writes.
2. New host reload only invalidates batched state. Empty registration sets and an undefined Sisyphus prompt were captured before callbacks ran, breaking direct/category task validation and prompt rebaking. Materialize state before snapshots and test real task execution/rebake.
3. Directory file URLs with trailing slash did not normalize to the same path, allowing duplicate plugin IDs to discard configured options. Normalize decoded paths and pin overlapping URL/file migration.

Existing 29-check live receipts remain valid only for their stated scenarios, not complete installation/delegation proof. Refresh affected scenarios and obtain one delta re-review after corrections. No required gate is bypassed.
