# claude-plugins

Claude Code plugin marketplace maintained by [Blackpaw Studio](https://blackpaw.studio).

## Install

```shell
/plugin marketplace add blackpaw-studio/claude-plugins
```

Then install any plugin from the catalog:

```shell
/plugin install <plugin-name>@blackpaw-plugins
```

The repository slug is `blackpaw-studio/claude-plugins`; the marketplace identifier used at install time is `blackpaw-plugins`.

## Plugins

| Plugin | Description |
| --- | --- |
| [`blackpaw-telegram`](plugins/blackpaw-telegram) | Telegram channel — pairing, allowlists, groups with mention-triggers, Forum Topics, photo inbox, voice transcription (Groq/Deepgram/OpenAI/whisper-cli chain), document ingest (PDF/DOCX/CSV/TXT/JSON), inline-keyboard `ask_user`, SQLite history + search, scheduled reminders, ElevenLabs voice_reply, and permission relay. Fork of the official Anthropic plugin extended with non-daemon features from claude-telegram-supercharged. |

## Channel plugins and the research preview

Plugins that register as Claude Code [channels](https://code.claude.com/docs/en/channels) (for example, a Telegram or Slack bridge) are gated behind Anthropic's research-preview allowlist. To run a channel plugin from this marketplace before it is added to the official allowlist, launch Claude Code with:

```shell
claude --dangerously-load-development-channels plugin:<plugin-name>@blackpaw-plugins
```

Team and Enterprise organizations can instead list the plugin under `allowedChannelPlugins` in managed settings.

## Layout

```
.
├── .claude-plugin/
│   └── marketplace.json    # catalog manifest
└── plugins/                # individual plugins (subdirectories)
```

## Development

Validate the marketplace locally:

```shell
claude plugin validate .
```

Add this repo as a marketplace from a local checkout while iterating:

```shell
/plugin marketplace add ./claude-plugins
```

See the [Claude Code plugin marketplaces docs](https://code.claude.com/docs/en/plugin-marketplaces) for the full reference.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
