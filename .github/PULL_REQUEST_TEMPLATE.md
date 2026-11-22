## Summary
<!-- Briefly describe what this PR changes and why. -->

Fixes #(issue)

## Type of Change
- [ ] Bug fix
- [ ] New feature / enhancement
- [ ] Cross-platform (`crates/platform`)
- [ ] Security hardening
- [ ] Performance improvement
- [ ] Documentation / CI / Chore

## Verification Checklist
- [ ] `cargo test --workspace`
- [ ] `cargo run -q -p services --bin parity` (216/216)
- [ ] `bun test --cwd settings-ui` & `bun run --cwd settings-ui build`
- [ ] `bun test ./frontend/tests`
- [ ] Manual smoke check in the running app (if UI/OS behavior changed)
- [ ] Regression tests added if touching security-sensitive paths (`exec.rs`, `backup.rs`, `http.rs`, `mcp_client.rs`, `hooks.rs`, `phone.rs`, `brain.rs`, `eyes.rs`, `hands.rs`, `tauri.conf.json`)
- [ ] No secrets, `.signing/` files, or personal data included

## Screenshots / Notes (optional)
<!-- Add before/after screenshots for UI changes. -->
