# Teranga — Claude Skills

This directory ships reusable skills that Claude Code (and other agents that support the Agent Skills spec) auto-loads when working in this repo. They are tracked in git so the whole team gets the same behaviour.

## Installed Skills

| Skill                      | Source                                              | Purpose                                                                                                                                                                                                       |
| -------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `teranga-design-review`    | **first-party (this repo)**                         | **Primary entry point for all UX/UI work.** Wraps the four external skills below with Teranga's brand tokens, francophone-first constraints, and WCAG 2.1 AA floor.                                           |
| `frontend-design`          | [anthropics/skills](https://github.com/anthropics/skills/tree/main/skills/frontend-design) | Design-thinking guardrails: pick a bold aesthetic direction, avoid generic AI-slop patterns. Used as a *lens* — its "avoid Inter" advice is **overridden** by `teranga-design-review`.                        |
| `theme-factory`            | [anthropics/skills](https://github.com/anthropics/skills/tree/main/skills/theme-factory)   | 10 preset themes + on-the-fly theme generator. Used **only** to explore accent variants within the teranga palette.                                                                                           |
| `webapp-testing`           | [anthropics/skills](https://github.com/anthropics/skills/tree/main/skills/webapp-testing)  | Automated browser-driven UX/UI testing (focus trap, responsive breakpoints, keyboard flow). Run after every structural change.                                                                                |
| `ui-ux-pro-max`            | [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) | Reasoning engine: 161 industry rules, 67 UI styles, 57 font pairings, 99 UX guidelines, 25 chart types. Produces candidate design systems we then reconcile against our locked Teranga tokens.                |

## How Claude should use them

1. When a user asks for UI/UX work, **start with `teranga-design-review/SKILL.md`**.
2. The adapter skill instructs Claude to consult the four external skills as lenses, then return a proposal that respects Teranga tokens.
3. For heavy style explorations, invoke:
   ```bash
   python3 .claude/skills/ui-ux-pro-max/.claude/skills/ui-ux-pro-max/scripts/search.py "<product type>" --design-system
   ```
4. Verify changes with `webapp-testing` before marking work done.

## Pruning

The `ui-ux-pro-max` install was stripped of:
- Canvas font binaries under `ui-styling/canvas-fonts/` (5.3 MB; we use Inter via `next/font`).
- The nested `src/`, `.github/`, `.claude-plugin/` directories (not needed for skill execution).

## Updating

```bash
# Refresh Anthropic skills
cd /tmp && rm -rf anthropics-skills
git clone --depth=1 --filter=blob:none --sparse https://github.com/anthropics/skills.git anthropics-skills
cd anthropics-skills && git sparse-checkout set skills/frontend-design skills/theme-factory skills/webapp-testing
for s in frontend-design theme-factory webapp-testing; do
  rm -rf "$REPO_ROOT/.claude/skills/$s"
  cp -r "skills/$s" "$REPO_ROOT/.claude/skills/$s"
done

# Refresh ui-ux-pro-max
cd /tmp && rm -rf ui-ux-pro-max-skill
git clone --depth=1 https://github.com/nextlevelbuilder/ui-ux-pro-max-skill.git
rm -rf "$REPO_ROOT/.claude/skills/ui-ux-pro-max"
cp -r ui-ux-pro-max-skill "$REPO_ROOT/.claude/skills/ui-ux-pro-max"
rm -rf "$REPO_ROOT/.claude/skills/ui-ux-pro-max"/{.git,.github,.claude-plugin,src,cli,screenshots,preview}
rm -rf "$REPO_ROOT/.claude/skills/ui-ux-pro-max/.claude/skills/ui-styling/canvas-fonts"
```
