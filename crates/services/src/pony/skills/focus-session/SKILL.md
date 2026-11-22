---
name: focus-session
description: Starts a focused work block with a Pomodoro timer and an optional follow-up reminder. Use when the user wants to focus on a specific task.
license: MIT
compatibility: Sympony
allowed-tools: get_context pomodoro add_reminder add_todo
---
1. If the user hasn't named what they are focusing on, ask a quick question with `ask_user` (or check open todos via `get_context`).
2. Start a focus timer by calling `pomodoro` with `action: "start"`.
3. If they mentioned a break or check-in time, set it with `add_reminder`.
4. Reply in one short, encouraging sentence confirming the focus block has started.
