const cliUrl = process.argv.slice(2).find((argument) => argument !== '--');
const baseUrl = (cliUrl ?? process.env.DEPLOYMENT_URL ?? '').replace(/\/$/, '');
const accessToken = process.env.SUPABASE_ACCESS_TOKEN;

if (!baseUrl) {
  console.error('Usage: node scripts/verify-deployment.mjs https://your-app.vercel.app');
  process.exit(1);
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const body = await response.text();
  return { response, body };
}

const health = await request('/api/health');
if (!health.response.ok) {
  throw new Error(`/api/health returned ${health.response.status}: ${health.body.slice(0, 240)}`);
}

const cors = await request('/api/rank', {
  method: 'OPTIONS',
  headers: {
    Origin: 'chrome-extension://deployment-smoke-test',
    'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'authorization,content-type',
  },
});

if (cors.response.status !== 204) {
  throw new Error(`/api/rank OPTIONS returned ${cors.response.status}: ${cors.body.slice(0, 240)}`);
}

const allowOrigin = cors.response.headers.get('access-control-allow-origin');
if (allowOrigin !== 'chrome-extension://deployment-smoke-test') {
  throw new Error(`Unexpected CORS origin: ${allowOrigin ?? '(missing)'}`);
}

if (accessToken) {
  const rank = await request('/api/rank', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      mode: 'Work',
      candidates: [{ external_id: 'deployment-smoke', title: 'AI computer vision agents tutorial', channel_name: 'Smoke Test' }],
    }),
  });

  if (!rank.response.ok) {
    throw new Error(`/api/rank POST returned ${rank.response.status}: ${rank.body.slice(0, 240)}`);
  }

  const payload = JSON.parse(rank.body);
  if (!Array.isArray(payload.items) || payload.items.length !== 1) {
    throw new Error('Rank response did not contain exactly one feed item.');
  }

  console.log('Authenticated rank check passed.');
} else {
  console.log('Authenticated rank check skipped; set SUPABASE_ACCESS_TOKEN to enable it.');
}

console.log(`Deployment checks passed for ${baseUrl}.`);
