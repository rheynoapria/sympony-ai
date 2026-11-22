---
name: plan-my-day
description: Plans or reviews the user's day from their calendar, todos, and prayer times. Use when the user asks to plan, organize, or review today.
license: MIT
compatibility: Sympony
allowed-tools: get_context add_todo add_reminder
---
1. Call `get_context` to inspect today's calendar events, open todos, reminders, weather, and prayer times.
2. Group what matters into morning, afternoon, and evening blocks, noting fixed meetings and prayer times first.
3. Highlight the top 3 priorities and flag any schedule conflicts or overdue todos.
4. If the user wants new tasks or reminders added, offer to add them (or call `add_todo` / `add_reminder` if they explicitly asked).
5. Keep the plan scannable and short.
