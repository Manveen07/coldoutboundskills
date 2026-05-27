// ---------------------------------------------------------------------------
// File-based AI invoker (Task 17 redo)
//
// Reads pre-computed bridge responses from disk. Used by the 3-phase flow:
//   1. extract-signals (CLI)
//   2. prepare-bridge-prompts (CLI) → bridge-tasks.json
//   3. Claude Code dispatches Task subagents → bridge-responses/<person_id>.txt
//   4. render-with-signals --responses-dir reads responses
//
// No API key dependency. Matches the v4 working pattern.
// ---------------------------------------------------------------------------

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import type { AiInvoker } from './_bridge_writer';

export function makeFileBasedInvoker(responsesDir: string): AiInvoker {
  return async (
    _prompt: string,
    context?: { person_id?: string }
  ): Promise<string> => {
    if (!context?.person_id) {
      throw new Error('file-based invoker requires context.person_id');
    }
    const filePath = resolve(responsesDir, `${context.person_id}.txt`);
    if (!existsSync(filePath)) {
      throw new Error(
        `No bridge response found at ${filePath}. ` +
          `Did you run prepare-bridge-prompts.ts + dispatch subagents first?`
      );
    }
    const content = readFileSync(filePath, 'utf8').trim();
    if (content === 'FALLBACK' || content === '') {
      // Return a marker that will fail validation in writeBridgeSentence
      // → triggers degrade-to-fallback in renderLead. Uses banned words
      // deliberately so the existing reject path fires cleanly.
      return 'Smart leading brands at this stage diversify.';
    }
    return content;
  };
}
