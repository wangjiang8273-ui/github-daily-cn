import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const OUTPUT_FILE = path.join(DATA_DIR, 'repos.json');
const SNAPSHOT_FILE = path.join(DATA_DIR, 'snapshot.json');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const TRANSLATE_API_KEY = process.env.TRANSLATE_API_KEY || '';
const TRANSLATE_MODEL = process.env.TRANSLATE_MODEL || '';
const TRANSLATE_API_URL = normalizeApiUrl(process.env.TRANSLATE_API_URL || '');
const MAX_ITEMS = Number(process.env.MAX_ITEMS || 18);

const now = new Date();
const isoDate = daysAgo => new Date(now.getTime() - daysAgo * 86400000).toISOString().slice(0, 10);

const searchPlans = [
  {
    label: 'new',
    query: `created:>=${isoDate(60)} stars:>=30 fork:false archived:false`,
    weight: 1.35
  },
  {
    label: 'active',
    query: `pushed:>=${isoDate(14)} stars:>=500 fork:false archived:false`,
    weight: 1.0
  },
  {
    label: 'ai',
    query: `topic:ai pushed:>=${isoDate(30)} stars:>=100 fork:false archived:false`,
    weight: 1.15
  },
  {
    label: 'selfhosted',
    query: `topic:self-hosted pushed:>=${isoDate(45)} stars:>=100 fork:false archived:false`,
    weight: 1.12
  },
  {
    label: 'productivity',
    query: `topic:productivity pushed:>=${isoDate(60)} stars:>=50 fork:false archived:false`,
    weight: 1.18
  },
  {
    label: 'desktop',
    query: `topic:desktop-app pushed:>=${isoDate(90)} stars:>=50 fork:false archived:false`,
    weight: 1.15
  }
];

const EXCLUDE_PATTERNS = [
  /awesome[-_ ]/i,
  /interview/i,
  /roadmap/i,
  /cheatsheet/i,
  /tutorial/i,
  /course/i,
  /learning/i,
  /book/i,
  /list of/i,
  /collection of/i,
  /curated list/i,
  /examples?$/i,
  /benchmark/i,
  /dataset/i
];

const APP_SIGNALS = [
  'app', 'application', 'tool', 'platform', 'desktop', 'webapp', 'web-app',
  'self-hosted', 'selfhosted', 'productivity', 'editor', 'client', 'dashboard',
  'automation', 'workflow', 'assistant', 'studio', 'browser', 'chatbot', 'agent',
  'image-generation', 'video', 'audio', 'notes', 'calendar', 'project-management',
  'developer-tools', 'cli', 'terminal', 'database', 'monitoring', 'design'
];

const CATEGORY_RULES = [
  ['AI 应用', /\b(ai|llm|agent|chatbot|copilot|machine learning|image generation|voice assistant|rag)\b/i],
  ['自托管', /self[- ]?host|homelab|private cloud|own server/i],
  ['创意设计', /design|image|photo|video|audio|music|drawing|creative|animation|3d/i],
  ['开发工具', /developer|devtool|terminal|cli|code editor|ide|database|api client|debug|monitoring|devops/i],
  ['效率工具', /productivity|note|task|calendar|workflow|automation|office|knowledge base|project management/i]
];

await main();

async function main() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const previous = await readJson(SNAPSHOT_FILE, {});
  const candidates = new Map();

  for (const plan of searchPlans) {
    const items = await searchRepositories(plan.query);
    for (const repo of items) {
      const current = candidates.get(repo.full_name) || { ...repo, planWeights: [], planLabels: [] };
      current.planWeights.push(plan.weight);
      current.planLabels.push(plan.label);
      candidates.set(repo.full_name, current);
    }
  }

  let repos = [...candidates.values()]
    .filter(isUsableApplication)
    .map(repo => enrichScore(repo, previous[repo.full_name]))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(MAX_ITEMS * 2, 30));

  repos = await Promise.all(repos.map(async repo => {
    const readme = await fetchReadme(repo.full_name);
    return {
      ...repo,
      readmeExcerpt: cleanMarkdown(readme).slice(0, 5200)
    };
  }));

  const topRepos = repos.slice(0, MAX_ITEMS);
  const translations = await translateRepos(topRepos);

  const items = topRepos.map((repo, index) => {
    const translated = translations.get(repo.full_name) || {};
    return {
      id: repo.id,
      rank: index + 1,
      name: repo.name,
      fullName: repo.full_name,
      owner: repo.owner?.login || '',
      url: repo.html_url,
      homepage: repo.homepage || '',
      descriptionZh: translated.descriptionZh || repo.description || '暂无简介',
      descriptionOriginal: repo.description || '',
      summaryZh: translated.summaryZh || translated.descriptionZh || repo.description || '暂无简介',
      highlights: normalizeStringArray(translated.highlights, 4),
      suitableFor: translated.suitableFor || '',
      category: translated.category || inferCategory(repo),
      language: repo.language || '',
      license: repo.license?.spdx_id || repo.license?.name || '未标明',
      stars: repo.stargazers_count || 0,
      forks: repo.forks_count || 0,
      openIssues: repo.open_issues_count || 0,
      watchers: repo.watchers_count || 0,
      score: Math.round(repo.score * 10) / 10,
      starDelta: repo.starDelta || 0,
      createdAt: repo.created_at,
      pushedAt: repo.pushed_at,
      updatedAt: repo.updated_at,
      topics: repo.topics || [],
      translationStatus: translated.descriptionZh ? 'done' : 'pending'
    };
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    source: 'github-rest-api',
    algorithm: 'recent activity + stars + estimated daily growth + application signals',
    translationEnabled: Boolean(TRANSLATE_API_KEY && TRANSLATE_API_URL && TRANSLATE_MODEL),
    items
  };

  const snapshot = Object.fromEntries(
    [...candidates.values()].map(repo => [repo.full_name, {
      stars: repo.stargazers_count || 0,
      capturedAt: new Date().toISOString()
    }])
  );

  await fs.writeFile(OUTPUT_FILE, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  await fs.writeFile(SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
  console.log(`Updated ${items.length} repositories at ${payload.generatedAt}`);
}

async function searchRepositories(query) {
  const endpoint = new URL('https://api.github.com/search/repositories');
  endpoint.searchParams.set('q', query);
  endpoint.searchParams.set('sort', 'stars');
  endpoint.searchParams.set('order', 'desc');
  endpoint.searchParams.set('per_page', '50');

  const response = await fetch(endpoint, { headers: githubHeaders() });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub search failed (${response.status}): ${text.slice(0, 300)}`);
  }
  const payload = await response.json();
  return payload.items || [];
}

async function fetchReadme(fullName) {
  const response = await fetch(`https://api.github.com/repos/${fullName}/readme`, {
    headers: {
      ...githubHeaders(),
      Accept: 'application/vnd.github.raw+json'
    }
  });
  if (response.status === 404) return '';
  if (!response.ok) {
    console.warn(`README fetch failed for ${fullName}: ${response.status}`);
    return '';
  }
  return response.text();
}

function githubHeaders() {
  return {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'github-daily-cn',
    ...(GITHUB_TOKEN ? { Authorization: `Bearer ${GITHUB_TOKEN}` } : {})
  };
}

function isUsableApplication(repo) {
  const text = [repo.name, repo.description, ...(repo.topics || [])].filter(Boolean).join(' ').toLowerCase();
  if (!repo.description) return false;
  if (EXCLUDE_PATTERNS.some(pattern => pattern.test(text))) return false;
  if (repo.archived || repo.disabled || repo.fork) return false;

  const hasAppSignal = APP_SIGNALS.some(signal => text.includes(signal));
  const hasReleaseShape = Boolean(repo.homepage) || (repo.topics || []).some(topic => /app|tool|self-host|desktop|productivity|assistant/.test(topic));
  const strongPopularity = (repo.stargazers_count || 0) >= 2500;
  return hasAppSignal || hasReleaseShape || strongPopularity;
}

function enrichScore(repo, previous) {
  const stars = repo.stargazers_count || 0;
  const forks = repo.forks_count || 0;
  const ageDays = Math.max(1, (now - new Date(repo.created_at)) / 86400000);
  const pushedDays = Math.max(0, (now - new Date(repo.pushed_at)) / 86400000);
  const starVelocity = stars / Math.max(ageDays, 7);
  const starDelta = previous?.stars != null ? Math.max(0, stars - previous.stars) : 0;
  const planBoost = Math.max(...(repo.planWeights || [1]));
  const appText = [repo.name, repo.description, ...(repo.topics || [])].filter(Boolean).join(' ').toLowerCase();
  const appSignalCount = APP_SIGNALS.filter(signal => appText.includes(signal)).length;

  const score = (
    Math.log10(stars + 10) * 28 +
    Math.log10(forks + 10) * 7 +
    Math.log10(starVelocity + 1) * 19 +
    Math.log10(starDelta + 1) * 24 +
    Math.max(0, 18 - pushedDays) * 1.1 +
    Math.min(appSignalCount, 5) * 4
  ) * planBoost;

  return { ...repo, score, starDelta };
}

function inferCategory(repo) {
  const text = [repo.name, repo.description, ...(repo.topics || [])].filter(Boolean).join(' ');
  for (const [category, pattern] of CATEGORY_RULES) {
    if (pattern.test(text)) return category;
  }
  return '其他';
}

async function translateRepos(repos) {
  const results = new Map();
  if (!TRANSLATE_API_KEY || !TRANSLATE_API_URL || !TRANSLATE_MODEL) {
    console.warn('Translation skipped: set TRANSLATE_API_URL, TRANSLATE_API_KEY and TRANSLATE_MODEL.');
    return results;
  }

  for (let i = 0; i < repos.length; i += 4) {
    const batch = repos.slice(i, i + 4);
    try {
      const translated = await translateBatch(batch);
      for (const item of translated) {
        if (item?.fullName) results.set(item.fullName, item);
      }
    } catch (error) {
      console.warn(`Translation batch failed: ${error.message}`);
    }
  }
  return results;
}

async function translateBatch(repos) {
  const input = repos.map(repo => ({
    fullName: repo.full_name,
    name: repo.name,
    description: repo.description || '',
    topics: repo.topics || [],
    readmeExcerpt: repo.readmeExcerpt || ''
  }));

  const prompt = `你是一名中文开源产品编辑。请根据仓库简介与 README 摘要，为每个项目生成准确、克制、易懂的中文信息。\n\n规则：\n1. 不翻译项目名、公司名、技术专有名词。\n2. descriptionZh：忠实翻译原始 description，40-100 个汉字。\n3. summaryZh：说明它能做什么、核心价值是什么，70-150 个汉字；不要营销腔，不要编造 README 未出现的功能。\n4. highlights：2-4 个短标签，每个不超过 8 个汉字。\n5. suitableFor：一句话说明适合谁，不超过 35 个汉字。\n6. category 只能从“AI 应用、效率工具、开发工具、创意设计、自托管、其他”中选择一个。\n7. 只返回 JSON 数组，不要 Markdown，不要额外解释。\n\n输入：\n${JSON.stringify(input)}`;

  const response = await fetch(TRANSLATE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TRANSLATE_API_KEY}`
    },
    body: JSON.stringify({
      model: TRANSLATE_MODEL,
      temperature: 0.2,
      messages: [
        { role: 'system', content: '你只输出合法 JSON。所有事实必须来自用户提供的仓库信息。' },
        { role: 'user', content: prompt }
      ]
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Translation API ${response.status}: ${text.slice(0, 500)}`);
  }

  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content ?? payload.output_text ?? '';
  const parsed = safeJsonParse(content);
  if (!Array.isArray(parsed)) throw new Error('Translation response is not a JSON array.');
  return parsed;
}

function normalizeApiUrl(value) {
  if (!value) return '';
  const trimmed = value.replace(/\/$/, '');
  if (/\/chat\/completions$/i.test(trimmed)) return trimmed;
  if (/\/v1$/i.test(trimmed)) return `${trimmed}/chat/completions`;
  return trimmed;
}

function safeJsonParse(value) {
  const cleaned = String(value)
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('[');
    const end = cleaned.lastIndexOf(']');
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error('Unable to parse translation JSON.');
  }
}

function cleanMarkdown(value) {
  return String(value || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[|*_>`~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeStringArray(value, max) {
  if (!Array.isArray(value)) return [];
  return value.map(item => String(item).trim()).filter(Boolean).slice(0, max);
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}
