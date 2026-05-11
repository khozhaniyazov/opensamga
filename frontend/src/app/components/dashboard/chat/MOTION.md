# Chat motion library

This file is the single human-readable reference for the
`samga-anim-*` CSS classes used by the chat surface.
Token-to-class mapping is enforced at compile time by
`chatAnimationClasses.ts` (`ChatAnimationToken` union →
`TABLE` constant); the `__tests__/chatAnimationClasses.test.ts`
spec pins the unique-class invariant. The keyframes / transition
rules themselves live in `frontend/src/styles/index.css` under
the `samga-anim-*` namespace.

## Architecture

```
component code
    ↓ (uses)
chatAnimationClass({ token, reduce })
    ↓ (resolves)
"samga-anim-<token>"
    ↓ (matched by)
styles/index.css @keyframes / transition rules
```

Reduced-motion is gated **twice**, defence in depth:

1. **Helper layer** — `chatAnimationClass({ reduce: true })`
   returns `""` strict-equality to `true`, so a non-boolean
   value never accidentally suppresses animation.
2. **CSS layer** — a global `@media (prefers-reduced-motion:
reduce)` block in `styles/index.css` nukes
   `animation`/`transition`/`transform`/`backdrop-filter`/
   `box-shadow` for every `samga-anim-*` class regardless of
   how the class arrived. This catches static class strings
   that bypass the helper (e.g. `className="… samga-anim-pill"`
   without a hook).

## Tokens (21 total, sorted by introduction wave)

| Token             | Class                            | Wave | Duration | Easing                     | When to use                                                      |
| ----------------- | -------------------------------- | ---- | -------- | -------------------------- | ---------------------------------------------------------------- |
| messageEnter      | samga-anim-msg-enter             | 33b  | 280ms    | cubic-bezier(0.16,1,0.3,1) | Slide-up + fade for any message bubble (user OR assistant)       |
| disclosureExpand  | samga-anim-disclosure-expand     | 33b  | 220ms    | cubic-bezier(0.16,1,0.3,1) | Slide-down + fade for any newly-expanded disclosure body         |
| chipHoverLift     | samga-anim-chip-hover            | 33b  | 200ms    | cubic-bezier               | Hover translateY(-1px) + soft shadow on inline pills/chips       |
| sendPress         | samga-anim-send-press            | 33b  | 140ms    | cubic-bezier               | Scale(0.92) on `:active` for the send/stop primary button        |
| threadRowHover    | samga-anim-thread-row            | 33b  | 200ms    | ease                       | Hover translateX(2px) on ThreadRail row buttons                  |
| toolCardMount     | samga-anim-tool-card             | 33b  | 260ms    | cubic-bezier(0.16,1,0.3,1) | Scale 0.97→1 + fade on tool-card mount                           |
| streamingCaret    | samga-anim-caret                 | 33b  | 1.4s     | ease-in-out infinite       | Soft 1→0.4 opacity pulse for ALL "live" cues                     |
| pillMount         | samga-anim-pill                  | 33b  | 200ms    | cubic-bezier(0.16,1,0.3,1) | Slide-down + fade for any status pill on mount                   |
| composerFocusGlow | samga-anim-composer-glow         | 34e  | 200ms    | cubic-bezier               | `:focus-within` amber ring on the composer outer card            |
| popoverMount      | samga-anim-popover               | 34f  | 200ms    | cubic-bezier(0.16,1,0.3,1) | Generic popover mount: fade + translateY(-6px) + scale(0.98)→1   |
| modalScrim        | samga-anim-modal-scrim           | 34g  | 180ms    | ease-out                   | Scrim opacity 0→1 fade-in                                        |
| modalEnter        | samga-anim-modal                 | 34g  | 240ms    | cubic-bezier(0.16,1,0.3,1) | Modal dialog scale(0.96)+translateY(8px)→1 mount                 |
| chevronRotate     | samga-anim-chevron               | 35a  | 220ms    | cubic-bezier(0.16,1,0.3,1) | Rotation hooked off parent's `aria-expanded`/`data-state="open"` |
| skeletonShimmer   | samga-anim-skeleton              | 35b  | 1.6s     | linear infinite            | Amber-tinted gradient sweep on skeleton bars                     |
| copySuccess       | samga-anim-copy-success          | 35c  | 420ms    | cubic-bezier(0.16,1,0.3,1) | ✓ pop celebrating a copy action (0.6→1.18→1 scale)               |
| usagePulse        | samga-anim-usage-pulse           | 35d  | 2.4s     | ease-in-out infinite       | box-shadow ring pulse on the usage chip when ≥80% quota          |
| actionsReveal     | samga-anim-actions-reveal        | 35e  | 220ms    | cubic-bezier               | One-shot mount fade+slide for a revealed toolbar                 |
|                   | samga-anim-actions-reveal-target | 35e  | 220ms    | cubic-bezier               | Transition-only sibling for `.group:hover`/`:focus-within`       |
| scrimBlur         | samga-anim-scrim-blur            | 35f  | (none)   | (none)                     | `backdrop-filter: blur(8px) saturate(120%)` on scrims            |
| feedbackThanks    | samga-anim-feedback-thanks       | 36e  | 220ms    | cubic-bezier(0.16,1,0.3,1) | Slide-from-left + fade on the FeedbackButtons "thank you" chip   |
| cardHoverLift     | samga-anim-card-lift             | 36f  | 200ms    | cubic-bezier               | Hover translateY(-1px) + shadow growth on card-shaped surfaces   |
| tapRipple         | samga-anim-tap-ripple            | 36g  | 140ms    | cubic-bezier               | Material-style scale(0.96) + brightness(0.96) on `:active`       |

## Conventions

1. **Pure helper, never logic.** The helper resolves a class name —
   nothing else. Animations themselves are pure CSS so they survive
   SSR/hydration and don't depend on JS for their first frame.
2. **Material-3-ish curve.** Default easing is
   `cubic-bezier(0.16, 1, 0.3, 1)` — fast start, soft settle.
3. **Sub-300ms for entrances**, sub-150ms for tap/press feedback.
   Caret/skeleton/usagePulse are the only loops.
4. **Helper → CSS class only.** Helper never returns inline styles
   or numeric durations.
5. **CSS variables for parametric tokens.** `chevronRotate` exposes
   `--samga-chevron-rotate` so a single class serves both 90° (rest:
   ChevronRight) and 180° (rest: ChevronDown) consumers.
6. **Pair animation + transition where useful.** `actionsReveal` is
   a dual-class pattern: a one-shot keyframed mount (`-reveal`) AND
   a `:hover`/`:focus-within`-driven transition target
   (`-reveal-target`). Either alone is incomplete.
7. **Defence-in-depth reduced-motion gate** — see Architecture above.

## Adding a new token

1. Append to `ChatAnimationToken` union in `chatAnimationClasses.ts`
   with a JSDoc explaining the role + wave label.
2. Add the new entry to the `TABLE` constant.
3. Add a happy-path test to
   `__tests__/chatAnimationClasses.test.ts` and bump the unique-class
   invariant count by 1.
4. Add the keyframes/transition rules in `styles/index.css` near the
   other `samga-anim-*` rules.
5. Add the new class name(s) to the global
   `@media (prefers-reduced-motion: reduce)` block.
6. Update this file's table.

Pure-helper convention only — do not call into `useState` /
`useEffect` / `Intl` from inside the helper.
