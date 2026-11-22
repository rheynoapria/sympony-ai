---
name: wrap-up
description: End-of-day wrap-up that summarizes what got done and helps carry open todos to tomorrow. Use when the user wants to close out or review their day.
license: MIT
compatibility: Sympony
allowed-tools: get_context update_item add_reminder
---
1. Call `get_context` to check today's remaining calendar events, open todos, and Pomodoro progress.
2. Summarize what is still open in a short bulleted list.
3. For overdue or unfinished todos, suggest which ones to move to tomorrow morning and ask via `ask_user` before changing or removing items.
4. Once confirmed, update their times with `update_item` or set a morning reminder with `add_reminder`.
