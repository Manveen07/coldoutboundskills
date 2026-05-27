import { describe, it, expect } from 'vitest';
import { parseCsv, writeCsv } from '../scripts/_csv_io';

describe('parseCsv', () => {
  it('parses simple unquoted rows correctly', () => {
    const text = 'a,b,c\n1,2,3\n4,5,6';
    const { headers, rows } = parseCsv(text);
    expect(headers).toEqual(['a', 'b', 'c']);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ a: '1', b: '2', c: '3' });
    expect(rows[1]).toEqual({ a: '4', b: '5', c: '6' });
  });

  it('parses quoted fields with embedded commas correctly', () => {
    const text = 'name,description\nFoo,"hello, world"\nBar,"a, b, c"';
    const { headers, rows } = parseCsv(text);
    expect(headers).toEqual(['name', 'description']);
    expect(rows).toHaveLength(2);
    expect(rows[0].description).toBe('hello, world');
    expect(rows[1].description).toBe('a, b, c');
  });

  it('parses quoted fields with escaped quotes correctly', () => {
    const text = 'name,quote\nAlice,"She said ""hi"""\nBob,"a ""b"" c"';
    const { headers, rows } = parseCsv(text);
    expect(rows[0].quote).toBe('She said "hi"');
    expect(rows[1].quote).toBe('a "b" c');
  });
});

describe('writeCsv', () => {
  it('round-trips through parseCsv unchanged for row with commas and quotes', () => {
    const headers = ['id', 'text'];
    const original = [
      { id: '1', text: 'hello, world' },
      { id: '2', text: 'She said "hi"' },
      { id: '3', text: 'line1\nline2' },
      { id: '4', text: 'plain' },
    ];
    const csv = writeCsv(original, headers);
    const reparsed = parseCsv(csv);
    expect(reparsed.headers).toEqual(headers);
    expect(reparsed.rows).toEqual(original);
  });
});
