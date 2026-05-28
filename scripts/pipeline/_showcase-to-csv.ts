// Convert showcase JSON to CSV format ready for sharing/Smartlead.
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

function escape(v: string): string {
  if (v == null) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCsv(showcase: any): string {
  const headers = [
    'lead_name', 'title', 'company', 'domain', 'vertical',
    'dossier_summary',
    'email1_subject', 'email1_body',
    'email2_subject', 'email2_body',
    'email3_subject', 'email3_body',
    'email4_subject', 'email4_body',
  ];
  const lines = [headers.join(',')];
  for (const l of showcase.leads) {
    const row = [
      l.lead, l.title, l.lead.split(' / ')[1], l.domain, l.vertical ?? showcase.category,
      l.dossier_summary,
      l.email1?.subject ?? '', l.email1?.body ?? '',
      l.email2?.subject ?? '', l.email2?.body ?? '',
      l.email3?.subject ?? '', l.email3?.body ?? '',
      l.email4?.subject ?? '', l.email4?.body ?? '',
    ];
    lines.push(row.map(escape).join(','));
  }
  return lines.join('\n');
}

for (const client of ['mythic', 'bw']) {
  const json = JSON.parse(readFileSync(resolve(process.cwd(), `data/runs/showcase-2026-05-28/${client}-showcase.json`), 'utf8'));
  const csv = toCsv(json);
  writeFileSync(resolve(process.cwd(), `data/runs/showcase-2026-05-28/${client}-showcase.csv`), csv, 'utf8');
  console.log(`Wrote ${client}-showcase.csv: ${json.leads.length} leads`);
}
