# Retired configuration (2026-10-25)

What was removed from the user's Claude Code config when mcp-notify was replaced by the Claude Code Widget Telegram alerts (2.7.0):

- `hooks.settings.json`: the two hook entries (Stop, Notification) that lived in `~/.claude/settings.json`.
- `mcp-server.json`: the `notify` MCP server entry (user scope, `~/.claude.json`). Restore with `claude mcp add notify -s user -- node C:\Users\musia\tools\mcp-notify\dist\index.js`.
- `commands/`: the six `/notify-*` slash commands from `~/.claude/commands/`.

To restore, put the hook entries back into the matching events in `~/.claude/settings.json` and copy `commands/*.md` back to `~/.claude/commands/`.
