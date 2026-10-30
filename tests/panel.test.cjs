const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

// Exercise the network listener and panel controls without Chrome or dependencies.
function createPanel() {
  const elements = new Map();
  const documentListeners = {};
  function element() {
    let html = '';
    let text = '';
    let rows;
    const classes = new Set();
    const listeners = {};
    return {
      value: '', checked: false, dataset: {}, listeners,
      classList: {
        add(name) { classes.add(name); },
        remove(name) { classes.delete(name); },
        contains(name) { return classes.has(name); },
        toggle(name, force) {
          if (force ?? !classes.has(name)) classes.add(name);
          else classes.delete(name);
        }
      },
      scrollIntoView() {},
      addEventListener(type, handler) { listeners[type] = handler; },
      get innerHTML() { return html; },
      set innerHTML(value) { html = value; rows = undefined; },
      set textContent(value) {
        text = String(value);
        html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      },
      get textContent() { return text; },
      querySelectorAll(selector) {
        if (selector !== '.request-item') return [];
        return rows ??= [...html.matchAll(/class="request-item ([^"]*)" data-index="(\d+)"/g)].map(match => {
          const item = element();
          item.dataset.index = match[2];
          if (match[1].includes('selected')) item.classList.add('selected');
          return item;
        });
      },
      querySelector(selector) {
        const index = selector.match(/data-index="(\d+)"/)?.[1];
        return this.querySelectorAll('.request-item').find(row => row.dataset.index === index);
      }
    };
  }
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, element());
      return elements.get(id);
    },
    createElement: element,
    addEventListener(type, handler) { documentListeners[type] = handler; }
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
    select(index, modifiers = {}) {
      control('requests').querySelector(`.request-item[data-index="${index}"]`).listeners.click(modifiers);
    },
    selected() {
      return control('requests').querySelectorAll('.request-item')
        .filter(row => row.classList.contains('selected')).map(row => Number(row.dataset.index));
    },
    key(key, modifiers = {}) {
      documentListeners.keydown({ key, preventDefault() {}, ...modifiers });
    },
    clipboard: () => clipboard,
    async copySelected(format = 'json') {
      control('format').value = format;
      await control('copyBtn').listeners.click();
      return clipboard;
    },
    async copy(format) {
      const row = control('requests').querySelectorAll('.request-item')[0];
      row.listeners.click({});
      return this.copySelected(format);
    }
  };
}

const operation = name => ({ operationName: name, query: `query ${name} { id }` });

function copiedRequest(name) {
  return {
    endpoint: 'https://example.com/graphql', method: 'POST', status: 200,
    payload: operation(name), response: { data: { id: 1 } }
  };
}

test('incoming requests keep the selected row and preview on the same operation', async () => {
  const panel = createPanel();
  await panel.capture({ body: operation('Older') });
  await panel.capture({ body: operation('SelectedRequest') });
  await panel.capture({ body: operation('AnotherRequest') });
  panel.select(1);
  const preview = panel.control('previewBody').innerHTML;
  assert.match(preview, /SelectedRequest/);

  await panel.capture({ body: operation('NewRequest') });
  assert.deepEqual(panel.selected(), [2]);
  assert.equal(panel.control('previewBody').innerHTML, preview);
  assert.equal(panel.control('copyBtn').disabled, false);
  assert.deepEqual(panel.errors, []);
});

test('Copy Selected copies the previewed request after new traffic arrives', async () => {
  const panel = createPanel();
  await panel.capture({ body: operation('SelectedRequest') });
  panel.select(0);
  await panel.capture({ body: operation('NewRequest') });
  await panel.capture({ body: operation('AnotherRequest') });

  assert.deepEqual(JSON.parse(await panel.copySelected()), copiedRequest('SelectedRequest'));
  assert.match(panel.control('previewBody').innerHTML, /SelectedRequest/);
  assert.equal(panel.control('status').textContent, 'Copied 1 request! (json)');
  assert.deepEqual(panel.errors, []);
});

test('multiple selections and the range anchor follow requests when new traffic arrives', async () => {
  const panel = createPanel();
  for (const name of ['Older', 'SelectedRequest', 'AnotherRequest', 'NewRequest']) {
    await panel.capture({ body: operation(name) });
  }
  panel.select(2);
  panel.select(0, { ctrlKey: true });
  await panel.capture({ body: operation('Newer') });
  assert.deepEqual(panel.selected(), [1, 3]);
  assert.equal(panel.control('copyBtn').textContent, 'Copy 2 Selected');
  assert.deepEqual(JSON.parse(await panel.copySelected()), [copiedRequest('NewRequest'), copiedRequest('SelectedRequest')]);

  panel.select(4, { shiftKey: true });
  assert.deepEqual(panel.selected(), [1, 2, 3, 4]);
  panel.key('ArrowUp');
  assert.deepEqual(panel.selected(), [3]);
  assert.deepEqual(JSON.parse(await panel.copySelected()), copiedRequest('SelectedRequest'));
  panel.key('ArrowUp', { shiftKey: true });
  assert.deepEqual(panel.selected(), [2, 3]);
  panel.key('ArrowDown');
  assert.deepEqual(panel.selected(), [3]);
  panel.select(1, { metaKey: true });
  panel.select(1, { ctrlKey: true });
  assert.deepEqual(panel.selected(), [3]);
  panel.key('Enter');
  assert.deepEqual(JSON.parse(panel.clipboard()), copiedRequest('SelectedRequest'));
  panel.key('C', { ctrlKey: true, shiftKey: true });
  assert.deepEqual(JSON.parse(panel.clipboard()), copiedRequest('SelectedRequest'));
  assert.deepEqual(panel.errors, []);
});

test('selection stays attached to filtered requests even when hidden traffic arrives', async () => {
  const panel = createPanel();
  await panel.capture({ body: operation('SelectedRequest') });
  panel.graphqlOnly();
  panel.filter('SelectedRequest');
  panel.select(0);
  await panel.capture({ method: 'GET', url: 'https://example.com/other' });
  assert.deepEqual(panel.selected(), [1]);
  assert.deepEqual(JSON.parse(await panel.copySelected()), copiedRequest('SelectedRequest'));
  panel.filter('NoMatch');
  await panel.capture({ body: operation('NewRequest') });
  assert.deepEqual(JSON.parse(await panel.copySelected()), copiedRequest('SelectedRequest'));
  panel.filter('');
  assert.deepEqual(panel.selected(), [2]);
  assert.deepEqual(panel.errors, []);
});

test('evicting selected requests updates selection, copy count and preview', async () => {
  const panel = createPanel();
  for (let i = 0; i < 500; i++) await panel.capture({ body: operation(`Request${i}`) });
  panel.select(0);
  panel.select(499, { ctrlKey: true });
  await panel.capture({ body: operation('Newer') });
  assert.equal(panel.control('requests').querySelectorAll('.request-item').length, 500);
  assert.deepEqual(panel.selected(), [1]);
  assert.equal(panel.control('copyBtn').textContent, 'Copy Selected');
  assert.equal(panel.control('copyBtn').disabled, false);
  assert.match(panel.control('previewBody').innerHTML, /Request499/);
  assert.deepEqual(JSON.parse(await panel.copySelected()), copiedRequest('Request499'));

  panel.select(499);
  await panel.capture({ body: operation('Newest') });
  assert.deepEqual(panel.selected(), []);
  assert.equal(panel.control('copyBtn').disabled, true);
  assert.equal(panel.control('previewPanel').classList.contains('visible'), false);
  assert.equal(panel.control('mainSplit').classList.contains('has-preview'), false);
  const previousCopy = panel.clipboard();
  await panel.copySelected();
  assert.equal(panel.clipboard(), previousCopy);
  assert.equal(panel.control('status').textContent, 'No request selected');
  assert.deepEqual(panel.errors, []);
});

test('double-click copy and clearing the list keep their existing behavior', async () => {
  const panel = createPanel();
  await panel.capture({ body: operation('SelectedRequest') });
  panel.select(0);
  panel.control('format').value = 'json';
  panel.control('requests').querySelectorAll('.request-item')[0].listeners.dblclick();
  assert.deepEqual(JSON.parse(panel.clipboard()), copiedRequest('SelectedRequest'));
  panel.control('clearBtn').listeners.click();
  assert.deepEqual(panel.selected(), []);
  assert.match(panel.html(), /Requests will appear here/);
  assert.equal(panel.control('copyBtn').disabled, true);
  assert.equal(panel.control('previewPanel').classList.contains('visible'), false);
  assert.equal(panel.control('status').textContent, 'Cleared');
  await panel.capture({ body: operation('NewRequest') });
  assert.deepEqual(panel.selected(), []);
  assert.deepEqual(panel.errors, []);
});

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

test('anonymous operations retain the endpoint without inventing a name', async () => {
  const panel = createPanel();
  await panel.capture({ body: { query: '{ user { id } }' } });
  panel.graphqlOnly();
  assert.match(panel.html(), /graphql-badge/);
  assert.ok(panel.html().includes('>/graphql</span>'));
});

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
