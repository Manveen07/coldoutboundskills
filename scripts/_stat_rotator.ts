export const DEFAULT_STAT_POOL = [
  '103% higher LTV on DM-acquired vs paid-acquired customers',
  '3-8x ROAS on first direct mail tests',
  '20%+ direct mail productivity lift for DWR',
  'Built on co-op transactional data from 4,000+ brands',
  'Running direct mail for 300+ premium retail and DTC brands',
];

export class StatRotator {
  private used = new Map<string, Set<string>>();
  constructor(private pool: string[] = DEFAULT_STAT_POOL) {}

  nextFor(personId: string): string {
    const usedByLead = this.used.get(personId) ?? new Set<string>();
    const available = this.pool.filter(s => !usedByLead.has(s));
    if (available.length === 0) {
      throw new Error(`Stat pool exhausted for lead ${personId}`);
    }
    const choice = available[0];
    usedByLead.add(choice);
    this.used.set(personId, usedByLead);
    return choice;
  }

  reset(personId?: string): void {
    if (personId) this.used.delete(personId);
    else this.used.clear();
  }
}
