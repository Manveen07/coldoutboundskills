// Alternative AI invoker path (HTTP via OpenRouter). Not wired into default
// CLI as of Task 17 redo. Use file-based invoker via prepare-bridge-prompts.ts
// + subagent dispatch for production. This stays for future batch-automation
// scenarios where subagent dispatch isn't feasible (scheduled Smartlead runs).
export async function openRouterInvoke(prompt: string, apiKey: string, model = 'anthropic/claude-3-haiku'): Promise<string> {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 200,
      temperature: 0.3,
    }),
  });

  if (!res.ok) {
    throw new Error(`OpenRouter ${res.status}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content ?? '';
  return String(text).trim();
}
