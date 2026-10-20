import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectLanguageStats, createChartData, renderLanguageChart } from '../generate-language-charts.mjs';

test('the leading language and percentage come from the collected code bytes', () => {
  const data = createChartData({ 'C#': 600, TypeScript: 300, JavaScript: 100 });
  assert.equal(data.leading.name, 'C#');
  assert.equal(data.leading.percentage, 60);
  for (const layout of ['vertical', 'compact']) {
    const svg = renderLanguageChart(data, { layout, updatedAt: new Date('2026-10-20T12:00:00Z') });
    const centre = svg.match(/<g aria-label="Leading language">([\s\S]*?)<\/g>/)?.[1];
    assert.ok(centre, 'The donut must contain an accessible leading-language group');
    assert.match(centre, /text-anchor="middle"[^>]*>C#<\/text>/);
    assert.match(centre, /text-anchor="middle"[^>]*>60\.00%<\/text>/);
    assert.match(svg, /Most Used Languages/);
  }
});

test('the centre changes when another language becomes the leader', () => {
  const svg = renderLanguageChart(createChartData({ 'C#': 10, Python: 90 }), {
    layout: 'vertical', updatedAt: new Date('2026-10-20T12:00:00Z'),
  });
  assert.match(svg, />Python<\/text>/);
  assert.match(svg, />90\.00%<\/text>/);
});

test('hidden languages are counted as Other instead of inflating the visible percentages', () => {
  const stats = Object.fromEntries(Array.from({ length: 8 }, (value, index) => [`Language ${index}`, 10]));
  const data = createChartData(stats);
  assert.equal(data.entries.length, 7);
  assert.equal(data.leading.percentage, 12.5);
  assert.equal(data.entries.at(-1).name, 'Other');
  assert.equal(data.entries.at(-1).percentage, 25);
  assert.equal(data.entries.reduce((sum, entry) => sum + entry.percentage, 0), 100);
});

test('empty statistics do not fabricate a leading language', () => {
  assert.throws(() => createChartData({}), /No language data/);
  assert.throws(() => createChartData({ TypeScript: 0 }), /No language data/);
});

test('language names are escaped before inclusion in SVG markup', () => {
  const svg = renderLanguageChart(createChartData({ '<script>&"': 100 }), {
    layout: 'vertical', updatedAt: new Date('2026-10-20T12:00:00Z'),
  });
  assert.ok(svg.includes('&lt;script&gt;&amp;&quot;'));
  assert.ok(!svg.includes('<script>'));
});

test('collection sums public owned non-fork repositories and skips private, forked and foreign records', async () => {
  const requested = [];
  const repo = (name, extra = {}) => ({ name, fork: false, private: false, owner: { login: 'lankiman' }, ...extra });
  const fetchImpl = async (url) => {
    requested.push(String(url));
    const pathname = new URL(url).pathname;
    if (pathname === '/users/lankiman/repos') return Response.json([
      repo('one'), repo('two'), repo('fork', { fork: true }),
      repo('private', { private: true }), repo('foreign', { owner: { login: 'someone-else' } }),
    ]);
    if (pathname === '/repos/lankiman/one/languages') return Response.json({ 'C#': 600, JavaScript: 100 });
    if (pathname === '/repos/lankiman/two/languages') return Response.json({ TypeScript: 300, 'C#': 100 });
    throw new Error(`Unexpected request: ${url}`);
  };
  const stats = await collectLanguageStats('lankiman', { fetchImpl });
  assert.deepEqual(stats.bytes, { 'C#': 700, JavaScript: 100, TypeScript: 300 });
  assert.equal(stats.repositoryCount, 2);
  assert.equal(requested.length, 3);
});

test('collection follows pagination rather than silently stopping at the first page', async () => {
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/users/lankiman/repos') {
      const page = parsed.searchParams.get('page');
      return Response.json(page === '1'
        ? Array.from({ length: 100 }, (value, index) => ({ name: `fork-${index}`, fork: true, private: false, owner: { login: 'lankiman' } }))
        : [{ name: 'last', fork: false, private: false, owner: { login: 'lankiman' } }]);
    }
    return Response.json({ Go: 80 });
  };
  const stats = await collectLanguageStats('lankiman', { fetchImpl });
  assert.deepEqual(stats.bytes, { Go: 80 });
  assert.equal(stats.repositoryCount, 1);
});

test('a failed repository request fails the refresh rather than publishing partial statistics', async () => {
  const fetchImpl = async (url) => new URL(url).pathname.endsWith('/repos')
    ? Response.json([{ name: 'one', fork: false, private: false, owner: { login: 'lankiman' } }])
    : Response.json({ message: 'rate limited' }, { status: 403 });
  await assert.rejects(collectLanguageStats('lankiman', { fetchImpl }), /GitHub request failed \(403\)/);
});

test('malformed language data fails validation', async () => {
  const fetchImpl = async (url) => new URL(url).pathname.endsWith('/repos')
    ? Response.json([{ name: 'one', fork: false, private: false, owner: { login: 'lankiman' } }])
    : Response.json({ TypeScript: 'not a byte count' });
  await assert.rejects(collectLanguageStats('lankiman', { fetchImpl }), /Invalid language byte count/);
});
