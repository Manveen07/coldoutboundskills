import type { WriterEmail, WriterOutput } from './_write';
import type { ResearchDossier } from './_research';
import { runSubagentBatch, type SubagentDispatcher } from './_subagent_runner';

export interface MechanicalResult {
  pass: boolean;
  violations: string[];
}

export interface MechanicalOptions {
  wordCount: { min: number; max: number };
  banned: string[];
}

const FORBIDDEN_OPENERS = [
  /^hi\b/i, /^hello\b/i, /^hey\b/i,
  /^i hope this finds you well/i,
  /^i came across/i, /^i noticed/i,
  /^as a /i, /^in today's/i,
];

export function validateMechanical(email: WriterEmail, opts: MechanicalOptions): MechanicalResult {
  const violations: string[] = [];
  const body = email.body ?? '';

  const wordCount = body.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount < opts.wordCount.min || wordCount > opts.wordCount.max) {
    violations.push(`word count ${wordCount} outside bounds ${opts.wordCount.min}-${opts.wordCount.max}`);
  }

  if (body.includes('—') || /\s--\s/.test(body)) {
    violations.push('contains em dash');
  }

  if (body.includes('!')) {
    violations.push('contains exclamation point');
  }

  const bodyLower = body.toLowerCase();
  for (const phrase of opts.banned) {
    if (bodyLower.includes(phrase.toLowerCase())) {
      violations.push(`contains banned phrase "${phrase}"`);
    }
  }

  const trimmed = body.trimStart();
  for (const pattern of FORBIDDEN_OPENERS) {
    if (pattern.test(trimmed)) {
      violations.push(`forbidden opener pattern: ${pattern.source}`);
    }
  }

  if (/^[\s]*[-*•]\s/m.test(body)) {
    violations.push('contains bullet point');
  }

  return { pass: violations.length === 0, violations };
}

export interface SemanticResult {
  pass: boolean;
  score: number;
  issues: string[];
  suggestions: string[];
}

export function buildSemanticPrompt(opts: { email: WriterEmail; dossier: ResearchDossier }): string {
  return `You are reviewing a cold email for quality. Be strict.

Research dossier the writer had:
${JSON.stringify(opts.dossier, null, 2)}

Research detail the writer claims to have used:
"${opts.email.research_detail_used}"

Check:
1. Does the email reference the claimed research detail in a meaningful way?
2. Does it sound human or AI-generated? Common AI tells: "I noticed", "I came across", "I hope this finds", "leverage", "synergy", "in today's competitive landscape", "as a {title}".
3. Does it feel templated? Test: if you swapped the company name to a different company, would the email still make sense? If yes => fail.
4. Is there EXACTLY ONE specific research detail in the body? More than one fails.
5. Is the voice peer-to-peer for the recipient's title?

EMAIL:
Subject: ${opts.email.subject}
Body: ${opts.email.body}

Return JSON only:
{ "pass": true/false, "score": 1-10, "issues": ["array"], "suggestions": ["array"] }`;
}

export async function validateSemantic(
  email: WriterEmail,
  dossier: ResearchDossier,
  dispatch: SubagentDispatcher,
  passThreshold: number,
): Promise<SemanticResult> {
  const prompt = buildSemanticPrompt({ email, dossier });
  const results = await runSubagentBatch<SemanticResult>([prompt], dispatch, { batchSize: 1, maxRetries: 2 });
  const r = results[0];
  if (!r.success || !r.data) {
    return { pass: false, score: 0, issues: ['validator dispatch failed: ' + (r.error ?? 'unknown')], suggestions: [] };
  }
  const data = r.data;
  return {
    pass: data.pass && data.score >= passThreshold,
    score: data.score,
    issues: data.issues ?? [],
    suggestions: data.suggestions ?? [],
  };
}

export interface RolePlayResult {
  verdict: 'reply' | 'archive' | 'unsubscribe';
  reason: string;
  pass: boolean;
}

export function buildRolePlayPrompt(opts: { email: WriterEmail; recipientName: string; recipientTitle: string; recipientCompany: string }): string {
  return `You are ${opts.recipientName}, ${opts.recipientTitle} at ${opts.recipientCompany}.
Your inbox gets 100-200 cold emails a week. You are skeptical of agencies and SaaS pitches.
You just received this cold email:

Subject: ${opts.email.subject}
Body: ${opts.email.body}

Be brutally honest. What's your reaction? Would you:
- "reply" — interesting enough to respond
- "archive" — not bad but not worth time
- "unsubscribe" — bad enough to opt out

Return JSON only: { "verdict": "reply" | "archive" | "unsubscribe", "reason": "one sentence" }`;
}

export async function validateRolePlay(
  email: WriterEmail,
  recipient: { name: string; title: string; company: string },
  dispatch: SubagentDispatcher,
): Promise<RolePlayResult> {
  const prompt = buildRolePlayPrompt({
    email,
    recipientName: recipient.name,
    recipientTitle: recipient.title,
    recipientCompany: recipient.company,
  });
  const results = await runSubagentBatch<{ verdict: 'reply' | 'archive' | 'unsubscribe'; reason: string }>(
    [prompt], dispatch, { batchSize: 1, maxRetries: 2 }
  );
  const r = results[0];
  if (!r.success || !r.data) {
    return { verdict: 'archive', reason: 'validator dispatch failed', pass: false };
  }
  return { verdict: r.data.verdict, reason: r.data.reason, pass: r.data.verdict === 'reply' };
}

export interface ValidatorReport {
  email_id: 'email1' | 'email2' | 'email3' | 'email4';
  mechanical: MechanicalResult;
  semantic: SemanticResult;
  role_play?: RolePlayResult;
  regenerations: number;
  final_pass: boolean;
}

export interface ValidateOptions {
  output: WriterOutput;
  dossier: ResearchDossier;
  cfg: any;
  dispatch: SubagentDispatcher;
  semanticThreshold: number;
  recipientName: string;
  recipientTitle: string;
  recipientCompany: string;
}

const BOUNDS: Record<string, { min: number; max: number }> = {
  email1: { min: 60, max: 90 },
  email2: { min: 40, max: 70 },
  email3: { min: 40, max: 70 },
  email4: { min: 40, max: 70 },
};

export async function validateEmails(opts: ValidateOptions): Promise<ValidatorReport[]> {
  const banned = (opts.cfg.legal?.banned_words ?? []).concat(opts.cfg.copy_tone?.out_vocabulary ?? []);
  const reports: ValidatorReport[] = [];

  for (const key of ['email1', 'email2', 'email3', 'email4'] as const) {
    const email = opts.output[key];
    const mech = validateMechanical(email, { wordCount: BOUNDS[key], banned });
    const sem = await validateSemantic(email, opts.dossier, opts.dispatch, opts.semanticThreshold);
    let role: RolePlayResult | undefined;
    if (key === 'email1') {
      role = await validateRolePlay(email, { name: opts.recipientName, title: opts.recipientTitle, company: opts.recipientCompany }, opts.dispatch);
    }
    const finalPass = mech.pass && sem.pass && (role ? role.pass : true);
    reports.push({ email_id: key, mechanical: mech, semantic: sem, role_play: role, regenerations: 0, final_pass: finalPass });
  }
  return reports;
}
