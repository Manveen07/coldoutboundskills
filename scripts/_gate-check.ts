import { parseCsv } from './_csv_io';
import { buildGateSummary, printGateSummary } from './_quality_gate';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const path = process.argv[2] ?? 'profiles/mythic/campaigns/growth-codes/data/leads-final-qsr.csv';
const { rows } = parseCsv(readFileSync(resolve(process.cwd(), path), 'utf8'));
const s = buildGateSummary(rows, 'mythic', 'qsr');
printGateSummary(s);
process.stdout.write('\nSample E1:\n' + (s.sample_lead.email1_body ?? '') + '\n');
process.stdout.write('\nSample E3:\n' + (s.sample_lead.email3_body ?? '') + '\n');
