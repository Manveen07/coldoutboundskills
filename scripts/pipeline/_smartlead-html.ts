// Smartlead body converter. Run at API push time, not stored in data files.
//
// JSON storage = clean `\n\n` (source of truth)
// Smartlead campaign create = needs HTML body with <br><br>
//
// Rules:
// 1. Normalize line endings: \r\n / \r -> \n
// 2. Collapse 3+ blank lines to 2
// 3. Preserve spintax {a|b} and merge tags {{first_name}}, {first_name}
// 4. \n\n -> <br><br>, \n -> <br>
// 5. NO p/br wrapping of spintax/merge-tag contents

const MERGETAG_RE = /\{\{[^}]+\}\}|\{[^{}|]+\}/g;
const SPINTAX_RE = /\{[^{}]*\|[^{}]*\}/g;

export function toSmartleadHtml(body: string): string {
  if (!body) return body;

  // Step 1: extract protected tokens (spintax + merge tags) so newlines inside don't get touched
  const tokens: string[] = [];
  let working = body;
  working = working.replace(SPINTAX_RE, (m) => {
    tokens.push(m);
    return `\x00T${tokens.length - 1}\x00`;
  });
  working = working.replace(MERGETAG_RE, (m) => {
    tokens.push(m);
    return `\x00T${tokens.length - 1}\x00`;
  });

  // Step 2: normalize line endings
  working = working.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Step 3: collapse 3+ blank lines to 2 (i.e. \n\n\n+ -> \n\n)
  working = working.replace(/\n{3,}/g, '\n\n');

  // Step 4: \n\n -> <br><br>, then remaining \n -> <br>
  working = working.replace(/\n\n/g, '<br><br>');
  working = working.replace(/\n/g, '<br>');

  // Step 5: restore protected tokens
  working = working.replace(/\x00T(\d+)\x00/g, (_, i) => tokens[+i]);

  return working;
}

// Run as CLI: node _smartlead-html.ts < in.txt > out.html
if (require.main === module) {
  const input = require('fs').readFileSync(0, 'utf8');
  process.stdout.write(toSmartleadHtml(input));
}
