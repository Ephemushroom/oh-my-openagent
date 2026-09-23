# Manual QA

- Surface: isolated OpenCode 2.0.15 API server plus loopback mock model.
- Evidence: `.omo/evidence/20260923-opencode2-sdk-2.0.15/green-api-3/receipt.json`, `native-team-2/receipt.json`, and `workflow-team-2/receipt.json`.
- Surface: isolated OpenCode 2.0.15 `mini` TUI under tmux. `/btw` input was accepted by the host UI; the fake provider intentionally did not produce an answer. Evidence: `native-btw-tui-2/receipt.txt` and `native-btw-tui-2/tmux-final.log`.
- Isolation: every live driver reported unchanged real host config/session state and cleaned its child processes.
