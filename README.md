# Jev Reflection

A Codex plugin that uses hooks to send working context to [TypeSafe Jev](https://typesafe.ai) every five minutes during active work. It catches costly detours while the agent is working, before they turn into wasted time or rework after review.

Checks run in the background. When Jev raises a concern, the agent briefly reflects and decides what to do. Quiet checks do not interrupt the agent.

| Feature | Problem | How it helps |
| --- | --- | --- |
| 🎯 `focus` | The agent is overengineering or doing unrequested work. | Flags unnecessary additions against the task's scope. |
| 🔍 `cause` | The agent is fixing a symptom while leaving its cause active. | Questions whether the fix addresses the cause across relevant scenarios. |
| 🧪 `probe` | The agent is investing in an untested assumption. | Suggests checking the prerequisite before building on it. |
| ⏱️ `pace` | The agent is waiting or repeating work without useful progress. | Prompts reassessment using elapsed time, costs and observed results. |
| 👀 `perspective` | The agent may be overlooking something consequential. | Requests a read-only supervisor with fresh context to inspect work in progress. |
| Progress HUD | Progress or a drop in completion is unclear. | Estimates completion every 15 minutes and notes scope growth or revised estimates. |
| Checkpoints | Jev cannot infer every plan or uncertainty from tools. | Provides two-way communication: the agent submits plans and options through `jev_checkpoint`, receives feedback and reports its decision. |

`●●●●○○○○○○ — ~40% of the plan completed. Scope expanded (+2 plan items).`

## Install

Requires Node.js 18+, Codex plugin support and a [TypeSafe API key](https://console.typesafe.ai/). TypeSafe usage is billed separately.

**Ask your agent to follow the [installation guide](docs/install.md).** It must ask your permission to share context, save your consent in global rules, and configure tool permissions. Enter the key through a masked field or directly in the configuration file opened in Codex—never in chat.
