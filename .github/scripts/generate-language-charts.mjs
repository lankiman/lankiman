import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const colors = ['#7055df', '#3178c6', '#f1e05a', '#e34c26', '#673195', '#777777', '#a4acb6'];

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[character]);
}

export async function collectLanguageStats(username, { fetchImpl = fetch, token } = {}) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}$/.test(username)) {
    throw new Error('Invalid GitHub username');
  }

  async function getJson(path) {
    const response = await fetchImpl(`https://api.github.com${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'lankiman-profile-language-chart',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`GitHub request failed (${response.status}); existing charts were not refreshed.`);
    return response.json();
  }

  const bytes = {};
  const visited = new Set();
  let repositoryCount = 0;
  for (let page = 1; ; page += 1) {
    const repositories = await getJson(`/users/${encodeURIComponent(username)}/repos?type=owner&per_page=100&sort=full_name&page=${page}`);
    if (!Array.isArray(repositories)) throw new Error('Invalid repository response');

    for (const repository of repositories) {
      if (!isRecord(repository) || typeof repository.name !== 'string' ||
        typeof repository.private !== 'boolean' || typeof repository.fork !== 'boolean' ||
        !isRecord(repository.owner) || typeof repository.owner.login !== 'string') {
        throw new Error('Invalid repository record');
      }
      if (repository.private || repository.fork || repository.owner.login.toLowerCase() !== username.toLowerCase()) continue;
      const key = repository.name.toLowerCase();
      if (visited.has(key)) continue;
      visited.add(key);

      const languages = await getJson(`/repos/${encodeURIComponent(username)}/${encodeURIComponent(repository.name)}/languages`);
      if (!isRecord(languages)) throw new Error('Invalid language response');
      for (const [name, size] of Object.entries(languages)) {
        if (!Number.isSafeInteger(size) || size < 0) throw new Error('Invalid language byte count');
        bytes[name] = (Object.hasOwn(bytes, name) ? bytes[name] : 0) + size;
      }
      repositoryCount += 1;
    }
    if (repositories.length < 100) break;
  }
  return { bytes, repositoryCount };
}

export function createChartData(bytes) {
  const languages = Object.entries(bytes).map(([name, size]) => {
    if (!Number.isSafeInteger(size) || size < 0) throw new Error('Invalid language byte count');
    return { name, size };
  }).filter((language) => language.size > 0).sort((a, b) => b.size - a.size || a.name.localeCompare(b.name));
  const total = languages.reduce((sum, language) => sum + language.size, 0);
  if (!total) throw new Error('No language data; existing charts were not refreshed.');

  const visible = languages.slice(0, 6);
  const other = languages.slice(6).reduce((sum, language) => sum + language.size, 0);
  if (other > 0) visible.push({ name: 'Other', size: other });
  const entries = visible.map((language, index) => ({
    ...language, percentage: language.size / total * 100, color: colors[index],
  }));
  return { entries, leading: entries[0], total };
}

function renderRing(entries, cx, cy, radius, strokeWidth) {
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return entries.map((entry) => {
    const length = entry.percentage / 100 * circumference;
    const circle = `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="${entry.color}" stroke-width="${strokeWidth}" stroke-dasharray="${length.toFixed(3)} ${(circumference - length).toFixed(3)}" stroke-dashoffset="${(-offset).toFixed(3)}" transform="rotate(-90 ${cx} ${cy})" />`;
    offset += length;
    return circle;
  }).join('\n');
}

export function renderLanguageChart(data, { layout = 'vertical', updatedAt = new Date(), repositoryCount } = {}) {
  if (layout !== 'vertical' && layout !== 'compact') throw new Error('Unsupported chart layout');
  const compact = layout === 'compact';
  const width = compact ? 350 : 300;
  const height = compact ? 247 : 375;
  const cx = compact ? 260 : 150;
  const cy = compact ? 134 : 148;
  const radius = compact ? 57 : 78;
  const strokeWidth = compact ? 14 : 24;
  const date = updatedAt.toISOString().slice(0, 10);
  const leadingFontSize = Math.min(compact ? 23 : 28, 105 / (data.leading.name.length * 0.65));
  const description = `Languages by code bytes across public, owned, non-forked repositories. Leading language: ${data.leading.name}, ${data.leading.percentage.toFixed(2)}%. Updated ${date}. ${data.entries.map((entry) => `${entry.name}: ${entry.percentage.toFixed(2)}%`).join('; ')}.`;
  const legend = data.entries.map((entry, index) => {
    const x = compact ? 23 : 23 + (index % 2) * 139;
    const y = compact ? 71 + index * 23 : 273 + Math.floor(index / 2) * 21;
    const maxNameLength = compact ? 17 : 13;
    const name = entry.name.length > maxNameLength ? `${entry.name.slice(0, maxNameLength - 1)}…` : entry.name;
    return `<g><title>${escapeXml(entry.name)}: ${entry.percentage.toFixed(2)}%</title><circle cx="${x}" cy="${y - 4}" r="4" fill="${entry.color}" /><text x="${x + 10}" y="${y}" class="legend">${escapeXml(name)}</text><text x="${compact ? 169 : x + 116}" y="${y}" text-anchor="end" class="legend">${entry.percentage.toFixed(2)}%</text></g>`;
  }).join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="chart-title chart-description">
<title id="chart-title">Most Used Languages</title>
<desc id="chart-description">${escapeXml(description)}</desc>
<style>text{font-family:'Segoe UI',Ubuntu,Arial,sans-serif}.legend{font-size:10px;fill:#b8b8b8}.caption{font-size:9px;fill:#999}</style>
<rect width="${width}" height="${height}" rx="5" fill="#151515" />
<text x="23" y="32" fill="#fff" font-size="18" font-weight="600">Most Used Languages</text>
${renderRing(data.entries, cx, cy, radius, strokeWidth)}
<g aria-label="Leading language">
<text x="${cx}" y="${cy - 3}" text-anchor="middle" fill="#fff" font-size="${leadingFontSize.toFixed(1)}" font-weight="700">${escapeXml(data.leading.name)}</text>
<text x="${cx}" y="${cy + 22}" text-anchor="middle" fill="#b8b8b8" font-size="${compact ? 13 : 16}">${data.leading.percentage.toFixed(2)}%</text>
</g>
${legend}
<text x="23" y="${height - 14}" class="caption">${repositoryCount === undefined ? 'Public repos' : `${repositoryCount} public repos`} · code size · ${date}</text>
</svg>\n`;
}

async function generateCharts() {
  const username = process.env.PROFILE_USER || 'lankiman';
  const stats = await collectLanguageStats(username, { token: process.env.GITHUB_TOKEN });
  const data = createChartData(stats.bytes);
  const options = { updatedAt: new Date(), repositoryCount: stats.repositoryCount };
  // Fetch and validate everything before writing either chart. A failed CI step commits nothing.
  const vertical = renderLanguageChart(data, { ...options, layout: 'vertical' });
  const compact = renderLanguageChart(data, { ...options, layout: 'compact' });
  const assets = new URL('../../assets/', import.meta.url);
  await mkdir(assets, { recursive: true });
  await writeFile(new URL('top-languages.svg', assets), vertical);
  await writeFile(new URL('top-languages-compact.svg', assets), compact);
  console.log(`Updated public-language charts: ${stats.repositoryCount} repositories; leading language ${data.leading.name} (${data.leading.percentage.toFixed(2)}%).`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await generateCharts();
}
