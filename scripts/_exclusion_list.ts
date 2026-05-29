import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

export interface ExclusionSet {
  domains: Set<string>;
  companyNames: Set<string>;
}

export function buildExclusionSet(csvText: string): ExclusionSet {
  const domains = new Set<string>();
  const companyNames = new Set<string>();
  const lines = csvText.split('\n').filter(Boolean);
  for (const line of lines.slice(1)) {
    const [domain, company_name] = line.split(',');
    if (domain?.trim()) domains.add(domain.trim().toLowerCase());
    if (company_name?.trim()) companyNames.add(company_name.trim().toLowerCase());
  }
  return { domains, companyNames };
}

export function loadExclusionSet(csvPath?: string): ExclusionSet {
  const path = csvPath ?? resolve(process.cwd(), 'data/exclusion-list.csv');
  if (!existsSync(path)) return { domains: new Set(), companyNames: new Set() };
  return buildExclusionSet(readFileSync(path, 'utf8'));
}

export function isExcluded(domain: string, exclusionSet: ExclusionSet, companyName?: string): boolean {
  const d = domain.toLowerCase().replace(/^www\./, '');
  if (exclusionSet.domains.has(d)) return true;
  for (const excluded of exclusionSet.domains) {
    if (d.endsWith(`.${excluded}`)) return true;
  }
  if (companyName && exclusionSet.companyNames.has(companyName.toLowerCase())) return true;
  return false;
}

// Module-level cache so loadExclusionSet is only called once per process
let _cached: ExclusionSet | null = null;
export function getExclusionSet(csvPath?: string): ExclusionSet {
  if (!_cached) _cached = loadExclusionSet(csvPath);
  return _cached;
}
