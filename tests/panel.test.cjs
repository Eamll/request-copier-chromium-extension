const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

// Exercise the network listener and panel controls without Chrome or dependencies.
function createPanel() {
  const elements = new Map();
  function element() {
    let html = '';
    let text = '';
    const listeners = {};
    return {
      value: '', checked: false, dataset: {}, listeners,
      classList: { add() {}, remove() {}, toggle() {} },
      addEventListener(type, handler) { listeners[type] = handler; },
      get innerHTML() { return html; },
      set innerHTML(value) { html = value; },
      set textContent(value) {
        text = String(value);
        html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      },
      get textContent() { return text; },
      querySelectorAll(selector) {
        if (selector !== '.request-item') return [];
        return [...html.matchAll(/data-index="(\d+)"/g)].map(match => {
          const item = element();
          item.dataset.index = match[1];
          return item;
        });
      }
    };
  }
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, element());
      return elements.get(id);
    },
    createElement: element,
    addEventListener() {}
  };
  let capture;
  let clipboard;
  const errors = [];
  const context = vm.createContext({
    document, URL, URLSearchParams, setTimeout() {},
    console: { error(...args) { errors.push(args); } },
    navigator: { clipboard: { async writeText(text) { clipboard = text; } } },
    chrome: { devtools: { network: { onRequestFinished: {
      addListener(listener) { capture = listener; }
    } } } }
  });
  const source = resolve(process.env.PANEL_SOURCE || resolve(__dirname, '../panel.js'));
  vm.runInContext(readFileSync(source, 'utf8'), context);
  const control = id => document.getElementById(id);
  return {
    control, errors,
    html: () => control('requests').innerHTML,
    async capture({ method = 'POST', url = 'https://example.com/graphql', body,
      contentType = 'application/json', resourceType = 'fetch' } = {}) {
      await capture({
        _resourceType: resourceType,
        request: { method, url, headers: [{ name: 'Content-Type', value: contentType }],
          queryString: [], postData: body === undefined ? undefined : {
            text: typeof body === 'string' ? body : JSON.stringify(body)
          } },
        response: { status: 200, statusText: 'OK', headers: [] },
        getContent(callback) { callback('{"data":{"id":1}}', ''); }
      });
    },
    filter(value) {
      control('filter').value = value;
      control('filter').listeners.input();
    },
    graphqlOnly() {
      control('graphqlToggle').checked = true;
      control('graphqlToggle').listeners.change();
    },
    async copy(format) {
      const row = control('requests').querySelectorAll('.request-item')[0];
      // Use the actual click handler attached by renderRequests.
      const original = control('requests').querySelectorAll;
      control('requests').querySelectorAll = selector => selector === '.request-item' ? [row] : [];
      control('filter').listeners.input();
      row.listeners.click({});
      control('requests').querySelectorAll = original;
      control('format').value = format;
      await control('copyBtn').listeners.click();
      return clipboard;
    }
  };
}

const cases = [
  ['explicit POST name', { body: { operationName: 'GetUser', query: 'query GetUser { user { id } }' } }, 'GetUser (query)'],
  ['name in query text', { body: { query: 'mutation SaveUser { saveUser { id } }' } }, 'SaveUser (mutation)'],
  ['raw GraphQL', { body: 'subscription OnUser { user { id } }' }, 'OnUser (subscription)'],
  ['GET query', { method: 'GET', url: 'https://example.com/graphql?query=' + encodeURIComponent('query GetUser { user { id } }') }, 'GetUser (query)'],
  ['persisted POST operation', { body: { operationName: 'GetUser', extensions: { persistedQuery: { version: 1, sha256Hash: 'abc' } } } }, 'GetUser'],
  ['persisted GET operation', { method: 'GET', url: 'https://example.com/graphql?operationName=GetUser&extensions=%7B%7D' }, 'GetUser'],
  ['batched operations', { body: [{ query: 'query GetUser { user { id } }' }, { query: 'mutation SaveUser { saveUser { id } }' }] }, 'GetUser (query), SaveUser (mutation)']
];

for (const [name, request, label] of cases) {
  test(`list shows ${name}`, async () => {
    const panel = createPanel();
    await panel.capture(request);
    panel.graphqlOnly();
    assert.match(panel.html(), /graphql-badge/);
    assert.ok(panel.html().includes(`>${label}</span>`), panel.html());
    assert.deepEqual(panel.errors, []);
  });
}

test('operation names are searchable with text, regex and invalid-regex fallback', async () => {
  const panel = createPanel();
  await panel.capture({ body: { query: 'query GetUser { user { id } }' } });
  for (const filter of ['getuser', '^POST .*GetUser', 'GetUser (']) {
    panel.filter(filter);
    assert.match(panel.html(), /data-index="0"/);
  }
  panel.filter('MissingOperation');
  assert.match(panel.html(), /No requests match the filter/);
});

for (const [style, query, field] of [
  ['variables', 'query ($status: BookStatus!, $library_ids: [ID!]) {\n  books(status: $status, library_ids: $library_ids) {\n    book_id\n    title\n    author\n    name\n    __typename\n  }\n}', 'books'],
  ['shorthand', '{ authors { name author_id __typename } }', 'authors'],
  ['default input objects', 'query ($filter: Filter = { status: "{active}" }) { books { id } }', 'books'],
  ['root aliases and comments', 'query { # root field\n  items: books { id } }', 'books']
]) {
  test(`anonymous ${style} uses the first root field as a list label only`, async () => {
    const panel = createPanel();
    await panel.capture({ body: { query } });
    panel.graphqlOnly();
    assert.match(panel.html(), /graphql-badge/);
    assert.ok(panel.html().includes(`>${field} (query)</span>`), panel.html());
    panel.filter(field);
    assert.match(panel.html(), /data-index="0"/);
    assert.equal(JSON.parse(await panel.copy('json')).payload.query, query);
    assert.doesNotMatch(await panel.copy('graphql'), /Operation:/);
    assert.deepEqual(panel.errors, []);
  });
}

test('ordinary requests, malformed bodies and URL searches still work', async () => {
  const panel = createPanel();
  for (const body of [undefined, 'not json', null, []]) {
    await panel.capture({ method: 'POST', url: 'https://example.com/users?page=1', body });
  }
  panel.filter('users\\?page=1');
  assert.equal((panel.html().match(/class="request-item/g) || []).length, 4);
  assert.ok(panel.html().includes('>/users?page=1</span>'));
  panel.graphqlOnly();
  assert.match(panel.html(), /No requests match the filter/);
  assert.deepEqual(panel.errors, []);
});

test('existing copy formats keep their output', async () => {
  const panel = createPanel();
  await panel.capture({ body: { query: 'query GetUser { user { id } }' } });
  const outputs = {};
  for (const format of ['json', 'curl', 'markdown', 'graphql']) outputs[format] = await panel.copy(format);
  assert.deepEqual(outputs, {
    json: '{\n  "endpoint": "https://example.com/graphql",\n  "method": "POST",\n  "status": 200,\n  "payload": {\n    "query": "query GetUser { user { id } }"\n  },\n  "response": {\n    "data": {\n      "id": 1\n    }\n  }\n}',
    curl: 'curl \'https://example.com/graphql\' \\\n  -X POST \\\n  -H \'Content-Type: application/json\' \\\n  --data-raw \'{"query":"query GetUser { user { id } }"}\'\n\n# Response (200 OK):\n{\n  "data": {\n    "id": 1\n  }\n}',
    markdown: '## POST /graphql\n\n**URL:** `https://example.com/graphql`\n\n**Status:** 200 OK\n\n### Request Payload\n```json\n{\n  "query": "query GetUser { user { id } }"\n}\n```\n\n### Response\n```json\n{\n  "data": {\n    "id": 1\n  }\n}\n```',
    graphql: 'Operation: GetUser\nType: query\n\nQuery:\nquery GetUser { user { id } }\n\nResponse:\n{\n  "data": {\n    "id": 1\n  }\n}'
  });
});


test('GraphQL payload highlights tokens without changing query text, variables or copy', async () => {
  const panel = createPanel();
  const query = 'query GetUser($id: ID!, $ratio: Float = -1.5e2) {\n  # query <comment>\n  user(id: $id, active: true, missing: null, role: ADMIN) @skip(if: false) {\n    alias: name(text: "<img src=x onerror=alert(1)> & query", block: """line\nquery""")\n    ...Fields\n  }\n}\nfragment Fields on User { id }';
  const body = { query, variables: { id: '123' } };
  await panel.capture({ body });
  const copied = await panel.copy('json');
  const html = panel.control('previewBody').innerHTML;
  for (const [type, token] of [
    ['keyword', 'query'], ['variable', '$id'], ['number', '-1.5e2'],
    ['comment', '# query &lt;comment&gt;'], ['boolean', 'true'],
    ['null', 'null'], ['directive', '@skip'], ['name', 'GetUser'],
    ['string', '"&lt;img src=x onerror=alert(1)&gt; &amp; query"'],
    ['string', '"""line\n    query"""']
  ]) assert.ok(html.includes(`<span class="gql-${type}">${token}</span>`), html);
  const queryHtml = html.split('<div class="preview-section-label">Query</div>')[1]
    .split('<div class="preview-section-label">Variables</div>')[0];
  const plain = queryHtml.replace(/<[^>]*>/g, '').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  // The existing preview formatter indents the continuation of block strings.
  assert.equal(plain, query.replace('line\nquery', 'line\n    query'));
  assert.ok(!html.includes('<img'));
  assert.match(html, /<span class="json-key">"id"<\/span>/);
  assert.match(html, /<span class="json-string">"123"<\/span>/);
  assert.deepEqual(JSON.parse(copied).payload, body);
  assert.deepEqual(panel.errors, []);
});
