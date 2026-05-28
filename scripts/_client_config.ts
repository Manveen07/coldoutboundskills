import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import yaml from 'js-yaml';

export interface ClientConfig {
  business: {
    name: string;
    website: string;
    one_liner: string;
    tone: string;
  };
  offer: {
    primary_product: string;
    primary_cta: string;
    lead_magnet: string;
    value_prop: string;
  };
  icp_hard_filters: {
    job_titles: string[];
    industries_in: string[];
    industries_out: string[];
    headcount_min: number;
    headcount_max: number;
    countries: string[];
    excluded_domains: string[];
  };
  proof_points: {
    headline_stats: Array<{ stat: string; attribution: string; product: string; vertical: string }>;
    vertical_anchor_map: Record<string, string[]>;
    portfolio_stats: string[];
    by_product: Record<string, any>;
  };
}

export function loadClientConfig(profilePath: string): ClientConfig {
  if (!existsSync(profilePath)) {
    throw new Error(`Client profile not found: ${profilePath}`);
  }
  const raw = readFileSync(profilePath, 'utf8');
  return yaml.load(raw) as ClientConfig;
}

export function loadClientConfigByName(clientName: string): ClientConfig {
  const path = resolve(process.cwd(), `profiles/${clientName}/client-profile.yaml`);
  return loadClientConfig(path);
}

export function getExcludedDomains(cfg: ClientConfig): string[] {
  return cfg.icp_hard_filters?.excluded_domains ?? [];
}

export function getVerticalAnchors(cfg: ClientConfig, vertical: string): string[] {
  return cfg.proof_points?.vertical_anchor_map?.[vertical] ?? [];
}

export function getPortfolioStats(cfg: ClientConfig): string[] {
  return cfg.proof_points?.portfolio_stats ?? [];
}

export function getIcpPromptPath(clientName: string): string {
  return resolve(process.cwd(), `profiles/${clientName}/icp-prompt.txt`);
}

// ---------------------------------------------------------------------------
// Standardized pipeline extensions
// ---------------------------------------------------------------------------

export function getPriorityDomains(cfg: ClientConfig): string[] {
  return ((cfg as any).priority_domains ?? []) as string[];
}

export function getCopyStyle(cfg: ClientConfig): {
  vocab_in: string[];
  vocab_out: string[];
  banned_phrases: string[];
  tone: string;
} {
  const c = (cfg as any).copy_tone ?? {};
  return {
    vocab_in: c.in_vocabulary ?? [],
    vocab_out: c.out_vocabulary ?? [],
    banned_phrases: (cfg as any).legal?.banned_words ?? [],
    tone: c.style ?? cfg.business?.tone ?? 'peer-to-peer',
  };
}

export function getExampleEmails(clientName: string): string[] {
  const p = resolve(process.cwd(), `profiles/${clientName}/example-emails.md`);
  if (!existsSync(p)) return [];
  const raw = readFileSync(p, 'utf8');
  // Split on lines that are exactly "---". Drop empty parts and the H1 header part.
  const parts = raw.split(/^---\s*$/m).map(s => s.trim()).filter(s => s.length > 0);
  // First part is usually the H1/intro -- drop it if it starts with #
  return parts.filter(p => !p.startsWith('#'));
}
