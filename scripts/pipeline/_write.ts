import type { ResearchDossier } from './_research';
import type { ClientConfig } from '../_client_config';
import { getCopyStyle } from '../_client_config';
import { runSubagentBatch, type SubagentDispatcher } from './_subagent_runner';

export interface WriterEmail {
  subject: string;
  body: string;
  research_detail_used: string;
}

export interface WriterOutput {
  email1: WriterEmail;
  email2: WriterEmail;
  email3: WriterEmail;
  email4: WriterEmail;
}

export interface WriterPromptOptions {
  dossier: ResearchDossier;
  cfg: ClientConfig;
  exampleEmails: string[];
  firstName: string;
}

export function buildWriterPrompt(opts: WriterPromptOptions): string {
  const { dossier, cfg, exampleEmails, firstName } = opts;
  const style = getCopyStyle(cfg);

  const examplesBlock = exampleEmails.length > 0
    ? `EXAMPLES OF GOOD EMAILS FOR THIS CLIENT (study the voice; do not copy):

${exampleEmails.map((e, i) => `--- EXAMPLE ${i + 1} ---\n${e}\n`).join('\n')}
`
    : '';

  return `You are an experienced cold email writer ghosting for ${cfg.business.name}.
You are writing to ${dossier.person.full_name}, ${dossier.person.title} at ${dossier.company.name}.
Recipient seniority: ${dossier.person.seniority}.

Voice: ${style.tone}. Peer to peer. Senior strategist to senior marketing leader.
You have done deep research. You will use ONE specific detail per email and discard the rest.

CLIENT POSITIONING:
${cfg.business.one_liner}

OFFER:
Product: ${cfg.offer.primary_product}
Value prop: ${cfg.offer.value_prop}
Primary CTA: ${cfg.offer.primary_cta}

ABSOLUTE RULES:
- Exactly ONE specific research detail in Email 1. No more.
- No em dashes (-- or em-dash char). No exclamation points. No bullet points in the body.
- Banned phrases: ${[...style.banned_phrases, ...style.vocab_out].join(', ')}
- Vocabulary to lean on: ${style.vocab_in.join(', ')}
- Email 1 body: 60-90 words. Email 2-4: 40-70 words.
- Open with the recipient's first name lowercase and an observation. No "Hi", "Hello", "I hope this finds you well", "I came across", "I noticed".
- Email 1 must NOT mention ${cfg.business.name} or ${cfg.offer.primary_product} in the first 3 sentences.
- The ask in Email 1 is a question, not a meeting invite.
- Each email references DIFFERENT aspects of the dossier. No repetition across the 4 emails.
- Email 2 is a threaded follow-up (empty subject string).
- Email 4 is a soft close (e.g. "if not you, who?"). Never aggressive.

${examplesBlock}
RESEARCH DOSSIER ON THIS LEAD:
${JSON.stringify(dossier, null, 2)}

OUTPUT FORMAT (JSON only, no markdown fences):
{
  "email1": { "subject": "...", "body": "...", "research_detail_used": "..." },
  "email2": { "subject": "", "body": "...", "research_detail_used": "..." },
  "email3": { "subject": "...", "body": "...", "research_detail_used": "..." },
  "email4": { "subject": "...", "body": "...", "research_detail_used": "..." }
}`;
}

export interface WriteLeadOptions {
  dossier: ResearchDossier;
  cfg: ClientConfig;
  exampleEmails: string[];
  firstName: string;
  dispatch: SubagentDispatcher;
  maxRetries?: number;
}

export async function writeEmailsForLead(opts: WriteLeadOptions): Promise<{ output: WriterOutput | null; error?: string }> {
  const prompt = buildWriterPrompt(opts);
  const results = await runSubagentBatch<WriterOutput>([prompt], opts.dispatch, {
    batchSize: 1,
    maxRetries: opts.maxRetries ?? 3,
    parseJson: true,
  });
  const r = results[0];
  if (!r.success) return { output: null, error: r.error };
  return { output: r.data ?? null };
}
