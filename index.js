#!/usr/bin/env node
'use strict';

const readline = require('readline');

const API_BASE = 'https://opendata.pku.edu.cn/api';
const WEB_BASE = 'https://opendata.pku.edu.cn';
const FETCH_TIMEOUT_MS = 25000;
const MAX_PER_PAGE = 100;

function log(msg) {
  process.stderr.write('[pku-opendata-mcp] ' + msg + '\n');
}

async function httpGet(path) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(API_BASE + path, {
      signal: ctrl.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'pku-opendata-mcp/1.0',
      },
    });
    if (res.status === 403) {
      throw new Error(
        'access denied by platform (HTTP 403). This server only exposes /api/search; ' +
          'all other Dataverse endpoints are closed to programmatic clients.'
      );
    }
    if (!res.ok) {
      throw new Error('platform returned HTTP ' + res.status);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function clampInt(value, fallback, min, max) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

function doiToWebUrl(globalId) {
  if (!globalId) return null;
  const suffix = String(globalId).replace(/^doi:/i, '');
  return WEB_BASE + '/dataset.xhtml?persistentId=doi:' + suffix;
}

function normalizePid(input) {
  if (!input) return null;
  let s = String(input).trim();
  s = s.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
  s = s.replace(/^https?:\/\/doi\.org\//i, '');
  s = s.replace(/^doi:/i, '');
  return s.toLowerCase();
}

function renderDatasetItem(it) {
  const name = it.name || '(untitled)';
  const link = it.url || doiToWebUrl(it.global_id);
  const lines = [];
  lines.push('- ' + name);
  lines.push('    DOI: ' + (it.global_id || 'n/a'));
  lines.push('    released: ' + (it.published_at ? it.published_at.slice(0, 10) : 'n/a'));
  lines.push('    dataverse: ' + (it.name_of_dataverse || 'n/a'));
  if (link) lines.push('    url: ' + link);
  if (it.description) {
    const d = String(it.description).replace(/\s+/g, ' ').trim();
    lines.push('    desc: ' + d.slice(0, 260) + (d.length > 260 ? '...' : ''));
  }
  return lines.join('\n');
}

function renderFileItem(it) {
  const lines = [];
  lines.push('- ' + (it.name || '(unnamed file)'));
  lines.push('    file_id: ' + (it.file_id ?? 'n/a'));
  lines.push('    type: ' + (it.file_type || it.file_content_type || 'n/a'));
  if (it.size_in_bytes != null) lines.push('    size_bytes: ' + it.size_in_bytes);
  if (it.md5) lines.push('    md5: ' + it.md5);
  lines.push('    dataset: ' + (it.dataset_name || 'n/a'));
  lines.push('    dataset_doi: ' + (it.dataset_persistent_id || 'n/a'));
  return lines.join('\n');
}

async function toolPlatformStats() {
  const ds = await httpGet('/search?q=*&type=dataset&per_page=1');
  const fl = await httpGet('/search?q=*&type=file&per_page=1');
  const d = ds.data.total_count;
  const f = fl.data.total_count;
  return [
    'Peking University Open Research Data Platform (opendata.pku.edu.cn)',
    '',
    'datasets: ' + d,
    'files: ' + f,
    'platform: Dataverse, operated by Peking University Library',
    'auth: none required for search',
    '',
    'Note: only /api/search is open. Dataset detail, file listing and direct download',
    'endpoints all return HTTP 403 to programmatic clients. Use the returned DOI links',
    'in a browser to obtain restricted files, or call pku_dataset_files to enumerate',
    'files belonging to a known DOI.',
  ].join('\n');
}

async function toolSearchDatasets(args) {
  const q = String(args.query || '*');
  const perPage = clampInt(args.per_page, 20, 1, MAX_PER_PAGE);
  const start = clampInt(args.start, 0, 0, 100000);
  const data = await httpGet(
    '/search?q=' + encodeURIComponent(q) + '&type=dataset&per_page=' + perPage + '&start=' + start
  );
  const d = data.data;
  const head = ['query: ' + q, 'total_count: ' + d.total_count, 'showing: ' + d.count_in_response, ''];
  if (!d.items || d.items.length === 0) return head.join('\n') + '(no datasets matched)';
  return head.join('\n') + d.items.map(renderDatasetItem).join('\n');
}

async function toolSearchFiles(args) {
  const q = String(args.query || '*');
  const perPage = clampInt(args.per_page, 20, 1, MAX_PER_PAGE);
  const start = clampInt(args.start, 0, 0, 100000);
  const data = await httpGet(
    '/search?q=' + encodeURIComponent(q) + '&type=file&per_page=' + perPage + '&start=' + start
  );
  const d = data.data;
  const head = ['query: ' + q, 'total_count: ' + d.total_count, 'showing: ' + d.count_in_response, ''];
  if (!d.items || d.items.length === 0) return head.join('\n') + '(no files matched)';
  return head.join('\n') + d.items.map(renderFileItem).join('\n');
}

async function toolGetDataset(args) {
  const raw = String(args.identifier || '').trim();
  if (!raw) throw new Error('identifier is required, e.g. 10.18170/DVN/VXPXUG');
  const wanted = normalizePid(raw);
  let found = null;
  for (let start = 0; start < 1000 && !found; start += MAX_PER_PAGE) {
    const data = await httpGet('/search?q=*&type=dataset&per_page=' + MAX_PER_PAGE + '&start=' + start);
    const items = data.data.items || [];
    found = items.find((it) => normalizePid(it.global_id) === wanted) || null;
    if (items.length < MAX_PER_PAGE) break;
  }
  if (!found) {
    return 'No dataset found for "' + raw + '" on this platform.';
  }
  const lines = [renderDatasetItem(found), ''];
  const web = found.url || doiToWebUrl(found.global_id);
  lines.push('Human-facing page (use this in a browser to request access or download files):');
  lines.push('  ' + web);
  lines.push('');
  lines.push('Files under this dataset can be enumerated with pku_dataset_files(' + found.global_id + ').');
  return lines.join('\n');
}

async function toolDatasetFiles(args) {
  const raw = String(args.identifier || '').trim();
  if (!raw) throw new Error('identifier is required, e.g. 10.18170/DVN/VXPXUG');
  const wanted = normalizePid(raw);
  const perPage = clampInt(args.per_page, 20, 1, MAX_PER_PAGE);
  const matches = [];
  let started = 0;
  for (let start = 0; start < 9000; start += MAX_PER_PAGE) {
    const data = await httpGet('/search?q=*&type=file&per_page=' + MAX_PER_PAGE + '&start=' + start);
    const items = data.data.items || [];
    for (const it of items) {
      if (normalizePid(it.dataset_persistent_id) === wanted) matches.push(it);
    }
    started += items.length;
    if (items.length < MAX_PER_PAGE) break;
    if (matches.length >= perPage) break;
  }
  if (matches.length === 0) {
    return (
      'No files matched DOI "' + raw + '". Scanned ' + started +
      ' file records. The DOI may be wrong, or the dataset may expose its files only through the web UI.'
    );
  }
  const slice = matches.slice(0, perPage);
  const head = ['files for ' + raw + ': ' + matches.length, ''];
  return head.join('\n') + slice.map(renderFileItem).join('\n');
}

const TOOLS = [
  {
    name: 'pku_platform_stats',
    description:
      'Report dataset and file counts for the Peking University Open Research Data Platform, plus its API access limits.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'pku_search_datasets',
    description:
      'Full-text search across the 497 published datasets of Peking University Open Research Data Platform. Returns title, DOI, release date, source dataverse and landing page URL.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search terms, e.g. "longevity". Use * to list everything. Default: *',
        },
        per_page: { type: 'integer', description: 'Results per page, 1-100. Default 20.' },
        start: { type: 'integer', description: 'Zero-based offset for paging. Default 0.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'pku_search_files',
    description:
      'Search individual data files on the Peking University Open Research Data Platform. Returns file id, format, byte size, md5 and the owning dataset DOI.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search terms, or * for all files. Default: *' },
        per_page: { type: 'integer', description: 'Results per page, 1-100. Default 20.' },
        start: { type: 'integer', description: 'Zero-based offset for paging. Default 0.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'pku_get_dataset',
    description:
      'Resolve a DOI to the exact dataset record and give the human-facing landing page URL used to request access or download.',
    inputSchema: {
      type: 'object',
      properties: {
        identifier: {
          type: 'string',
          description: 'DOI such as 10.18170/DVN/VXPXUG, or a doi.org URL containing it.',
        },
      },
      required: ['identifier'],
      additionalProperties: false,
    },
  },
  {
    name: 'pku_dataset_files',
    description:
      'Enumerate files belonging to one dataset by its DOI, since the platform does not expose a per-dataset file listing API.',
    inputSchema: {
      type: 'object',
      properties: {
        identifier: { type: 'string', description: 'Dataset DOI, e.g. 10.18170/DVN/VXPXUG.' },
        per_page: { type: 'integer', description: 'Max files to return. Default 20.' },
      },
      required: ['identifier'],
      additionalProperties: false,
    },
  },
];

const HANDLERS = {
  pku_platform_stats: toolPlatformStats,
  pku_search_datasets: toolSearchDatasets,
  pku_search_files: toolSearchFiles,
  pku_get_dataset: toolGetDataset,
  pku_dataset_files: toolDatasetFiles,
};

function makeResult(id, payload) {
  return { jsonrpc: '2.0', id, result: payload };
}

function makeError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

async function dispatchToolCall(name, args) {
  const fn = HANDLERS[name];
  if (!fn) throw new Error('unknown tool: ' + name);
  return await fn(args || {});
}

async function handleRequest(req) {
  const { id, method, params } = req;

  if (method === 'initialize') {
    return makeResult(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'pku-opendata-mcp', version: '1.0.0' },
    });
  }

  if (method === 'tools/list') {
    return makeResult(id, { tools: TOOLS });
  }

  if (method === 'tools/call') {
    try {
      const text = await dispatchToolCall(params && params.name, params && params.arguments);
      return makeResult(id, { content: [{ type: 'text', text }], isError: false });
    } catch (err) {
      return makeResult(id, {
        content: [{ type: 'text', text: 'Error: ' + (err && err.message ? err.message : String(err)) }],
        isError: true,
      });
    }
  }

  if (method === 'ping') return makeResult(id, {});
  if (method === 'resources/list') return makeResult(id, { resources: [] });
  if (method === 'prompts/list') return makeResult(id, { prompts: [] });

  return makeError(id, -32601, 'method not found: ' + method);
}

async function processLine(trimmed) {
  let req;
  try {
    req = JSON.parse(trimmed);
  } catch (e) {
    process.stdout.write(JSON.stringify(makeError(null, -32700, 'parse error')) + '\n');
    return;
  }
  if (req.id === undefined) return;
  let res;
  try {
    res = await handleRequest(req);
  } catch (err) {
    res = makeError(req.id, -32603, err && err.message ? err.message : String(err));
  }
  process.stdout.write(JSON.stringify(res) + '\n');
}

function main() {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  let chain = Promise.resolve();
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    chain = chain.then(() => processLine(trimmed)).catch((err) => {
      log('unhandled line error: ' + (err && err.message ? err.message : String(err)));
    });
  });
  rl.on('close', () => {
    chain.then(() => process.exit(0));
  });
  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
  log('server ready');
}

main();
