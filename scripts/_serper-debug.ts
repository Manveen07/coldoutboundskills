try {
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'X-API-KEY': '***REMOVED***', 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: 'test', gl: 'us' }),
  });
  console.log('Status:', res.status);
  console.log('Body:', await res.text());
} catch (err: any) {
  console.error('Error type:', err.constructor?.name);
  console.error('Error code:', err.code);
  console.error('Error cause:', err.cause?.code, err.cause?.message);
  console.error('Error message:', err.message);
}
