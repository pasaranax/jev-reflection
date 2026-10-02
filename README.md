# Jev Reflection

A local Codex plugin that uses [TypeSafe Jev](https://typesafe.ai) to check for scope drift, overengineering, unproductive loops, and unjustified waiting. During active work it checks on the first tool completion after each five-minute boundary. A signal of 80% or higher asks Codex to visibly reflect; lower scores stay silent.

## Install in Codex

Requirements: a current Codex CLI with `codex plugin`, Node.js 18+ available as `node`, and your own TypeSafe API key.

```sh
codex plugin marketplace add pasaranax/jev-reflection
codex plugin add jev-reflection@jev-reflection
```

In your Codex configuration (`~/.codex/config.toml`, or `$CODEX_HOME/config.toml` if customized), add your key to the existing section or create it:

```toml
[shell_environment_policy.set]
TYPESAFE_API_KEY = "your-typesafe-key"
```

Alternatively, launch Codex with `TYPESAFE_API_KEY` in its process environment. Never commit this key.

Start a new Codex chat. Review and trust the plugin hooks through `/hooks` when prompted. No `npm install` is needed.

To update:

```sh
codex plugin marketplace upgrade jev-reflection
codex plugin add jev-reflection@jev-reflection
```

## Data sent to TypeSafe

Scheduled checks send bounded excerpts of user and assistant messages, recent tool inputs and outputs, the working directory, and timing information to `https://api.typesafe.ai/v1/systemone`. The transcript reader examines only the final 256 KiB and excludes system, developer, and reasoning records. State stays in memory; the plugin writes no logs.

Common credential fields and token patterns are redacted, and the configured TypeSafe key is removed from the request body. Redaction is heuristic: other private information in chat or tool output can still be sent. Use the plugin only for tasks whose context you are willing to share with TypeSafe. API requests use your TypeSafe account and its usage limits or charges.

## Check locally

```sh
npm run check
```

MIT license.
