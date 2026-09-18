---
name: lingxi
description: Drive the 灵犀 desktop cat - react to how work is going with expressions, actions and short lines; remember things about the user; set reminders. Use when the user has 灵犀 running and wants the cat to respond to what you are doing, or asks you to make it do something. Triggers - 灵犀, 桌宠, desktop cat, "让猫", "cat react", "remind me".
---

# 灵犀 · 桌面猫

A cat lives on the user's desktop. You can see what it is doing and make it react.

Everything goes through the `lingxi` MCP server (see `integrations/README.md` for setup). If
those tools are not available, the cat is not wired up - say so rather than guessing.

## The one rule

**The cat shares a screen with someone who is working.** Everything below follows from that.
A cat that reacts once in a while is company; a cat that reacts to everything is a distraction
you will be asked to uninstall.

- Expressions and one-line bubbles: cheap, use freely.
- Actions: fine at natural pauses.
- **Full-screen performances: rare.** A long build finally going green. A test suite that was
  red all afternoon. Not a file write, not a tool call, not "I finished thinking".

Check `lingxi_state` before anything big. If the user is dragging the cat or playing with a
toy, they are already engaged with it - do not take it over.

## Start here

Call `lingxi_capabilities` first, every session. The action and expression libraries are
**user-editable JSON files** - people add their own. Ids differ between installs, and anything
you hardcode will eventually fail on someone's machine.

## Reacting to work

A rough mapping that fits the built-in library. Adapt it to whatever `lingxi_capabilities`
actually reports:

| What happened | expression | action | say |
|---|---|---|---|
| Starting something long | 认真 | — | — |
| Tests pass / build green | 开心 | `paw-wave` | "搞定啦～" |
| Tests fail / build red | 不爽 | `shake-head` | — |
| Need the user's input | 好奇 | `notice-you` | "在等你哦" |
| Something surprising | 惊吓 | `startle` | — |
| Long session, user still going | 困困 | `yawn` | — |
| Genuinely big win | — | — | `lingxi_perform` |

If the user has Claude Code hooks installed, the basic completed/failed/waiting reactions
already happen on their own. Do not duplicate them - add the ones the hooks cannot know about,
like reacting to what the work actually *was*.

## Remembering the user

`lingxi_remember` is what makes the cat feel like it knows them after a month. Write one
observation per call, in plain language:

- `{ text: "prefers measuring a bug before changing code", kind: "preference" }`
- `{ text: "building a desktop pet in Rust + TypeScript", kind: "project" }`
- `{ text: "gets frustrated by flaky tests", kind: "owner" }`

Good moments to write one: the user states a preference, corrects you on how they like to work,
finishes something they have been stuck on, or tells you about themselves.

**Never store**: credentials, tokens, API keys, file contents, anything private. `memory.json`
is a plain readable file in their config directory and they will open it. Write only what you
would be comfortable showing them - because you are.

Call `lingxi_recall` at the start of a session to pick up where you left off.

## Reminders

`lingxi_remind` surfaces as the cat looking up and saying the line - not a system notification.
Phrase it as the cat, in the user's language.

Use it for the thing they said they would come back to and probably will not: a TODO they left,
a test they skipped, a decision they deferred. Also fine for "you have been sitting for two
hours".

```
lingxi_remind({ text: "那个 flaky test 还没修哦", inMinutes: 90 })
```

## Playing

`lingxi_play` puts out a toy. The cat drops everything and plays with it. Nice when the user
finishes something big, or has clearly been grinding for hours. Take it away afterwards
(`{ toy: "none" }`) rather than leaving it out forever.
