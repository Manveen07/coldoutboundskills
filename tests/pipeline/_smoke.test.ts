import { describe, it, expect } from 'vitest';
import { selectSmokeLeads } from '../../scripts/pipeline/_smoke';
import type { ScoredLead } from '../../scripts/pipeline/_score';

const mkLead = (id: string, conf: number, domain: string): ScoredLead => ({
  person_id: id, first_name: 'A', last_name: 'B', full_name: 'A B',
  current_job_title: 'CMO', email: '', email_status: '', person_linkedin_url: '',
  person_city: '', person_state: '', person_country: '',
  company_name: domain, company_domain: domain, company_industry: '',
  company_headcount: '', company_headcount_range: '', company_linkedin_url: '',
  company_city: '', company_state: '', company_country: '',
  icp_qualified: 'true', icp_confidence: String(conf), icp_reason: '',
});

describe('selectSmokeLeads', () => {
  it('picks one lead per tier when possible', () => {
    const leads = [
      mkLead('a', 0.7, 'a.com'), mkLead('b', 0.85, 'b.com'),
      mkLead('c', 0.95, 'c.com'), mkLead('d', 0.7, 'd.com'),
    ];
    const picks = selectSmokeLeads(leads, [], { t2: 0.8, t3: 0.9 });
    expect(picks.length).toBe(3);
    const tiers = picks.map(p => p.tier);
    expect(tiers).toContain('T1');
    expect(tiers).toContain('T2');
    expect(tiers).toContain('T3');
  });

  it('falls back when fewer than 3 tiers represented', () => {
    // Both leads land in T1 (conf < 0.8). selectSmokeLeads picks one per tier so we get 1.
    const leads = [mkLead('a', 0.7, 'a.com'), mkLead('b', 0.85, 'b.com')];
    const picks = selectSmokeLeads(leads, [], { t2: 0.8, t3: 0.9 });
    expect(picks.length).toBe(2);
  });

  it('only considers qualified leads', () => {
    const lead = mkLead('a', 0.95, 'a.com');
    lead.icp_qualified = 'false';
    const picks = selectSmokeLeads([lead], [], { t2: 0.8, t3: 0.9 });
    expect(picks.length).toBe(0);
  });
});
