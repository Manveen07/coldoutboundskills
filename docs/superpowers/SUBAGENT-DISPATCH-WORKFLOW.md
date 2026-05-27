# Subagent Dispatch Workflow — Bridge Generation

## 3-phase flow

1. `extract-signals` (CLI) → `leads-with-signals.csv` + per-domain sidecars
2. `prepare-bridge-prompts` (CLI) → `data/bridge-tasks.json` listing leads that need bridges
3. **Claude Code dispatches Task subagents** → each writes `data/bridge-responses/<person_id>.txt`
4. `render-with-signals --responses-dir` (CLI) → `leads-final-v5.csv`

## Subagent dispatch template

When Claude Code dispatches a Task subagent to process bridge tasks, use this prompt:

```
You are processing bridge sentence generation tasks from bridge-tasks.json.

You will receive a list of pending tasks. For EACH task:

1. Read the prompt from the task object (already complete — do not modify).
2. Generate ONE bridge sentence following the prompt rules.
3. Validate the bridge against these constraints:
   - <=25 words
   - First word is capitalized
   - No banned words: smart, smarter, smartest, smartly, best, savvy, savviness,
     leading, leading-edge, top-tier, top-rated, great, exceptional, brilliant,
     brilliantly, amazing, awesome, fantastic, impressive, best-in-class,
     best-of-breed, fresh eyes, fresh perspective, fresh take, the right person,
     the right time, perfect timing, caught my eye, tends to, tend to, usually
     see, usually drives, often see, brands at this stage, brands at that stage,
     brands in this category, brands in that category
   - Does NOT start with: Saw, Saw that, Noticed, Caught, I see, I saw,
     I noticed, I caught, I'm guessing, I imagine, I am guessing, I could imagine

4. If invalid: regenerate stricter (max 2 internal retries). If still invalid
   after 2 retries → write "FALLBACK" as the response.

5. Write response to the task's response_file path (e.g.,
   data/bridge-responses/<person_id>.txt). One sentence, no newlines, no quotes.

6. Update the task's status in bridge-tasks.json to "completed" (or "fallback"
   if you gave up).

Process all assigned tasks. Report counts at the end: completed / fallback.
```

## Batching guidance

- Batch size: 10-20 tasks per subagent dispatch
- Parallel: dispatch 5-10 subagents simultaneously for large campaigns
- After all subagents complete: verify all `<person_id>.txt` files exist before running render

## OpenRouter alternative

`scripts/_ai_subagent.ts` has an `openRouterInvoke` function. Not wired into default CLI but kept for future automation (e.g. scheduled Smartlead runs where subagent dispatch isn't feasible). Requires `OPENROUTER_API_KEY` in `.env`.
