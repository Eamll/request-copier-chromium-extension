// Store all captured requests
const requests = [];
const selectedIndices = new Set();
let lastClickedIndex = -1;

// DOM elements
const requestsContainer = document.getElementById('requests');
const filterInput = document.getElementById('filter');
const formatSelect = document.getElementById('format');
const copyBtn = document.getElementById('copyBtn');
const clearBtn = document.getElementById('clearBtn');
const statusEl = document.getElementById('status');
const graphqlToggle = document.getElementById('graphqlToggle');
const mainSplit = document.getElementById('mainSplit');
const previewPanel = document.getElementById('previewPanel');
const previewSummary = document.getElementById('previewSummary');
const previewTabs = document.getElementById('previewTabs');
const previewBody = document.getElementById('previewBody');
let activePreviewTab = 'payload';
const typeFilterRow = document.getElementById('typeFilterRow');
const invertFilter = document.getElementById('invertFilter');
let activeTypeFilter = 'all';
const compactToggle = document.getElementById('compactToggle');

// Listen for network requests
chrome.devtools.network.onRequestFinished.addListener(async (request) => {
  const resourceType = (request._resourceType || '').toLowerCase();

  try {
    // Get response content
    const content = await new Promise((resolve) => {
      request.getContent((body, encoding) => {
        resolve({ body, encoding });
      });
    });

    const requestData = {
      id: Date.now() + Math.random(),
      method: request.request.method,
      url: request.request.url,
      headers: request.request.headers,
      queryString: request.request.queryString,
      postData: request.request.postData,
      status: request.response.status,
      statusText: request.response.statusText,
      responseHeaders: request.response.headers,
      responseBody: content.body,
      responseEncoding: content.encoding,
      resourceType: resourceType,
      time: new Date().toLocaleTimeString(),
      isGraphQL: isGraphQLRequest(request.request)
    };

    requests.unshift(requestData);
    
    // Keep max 500 requests
    if (requests.length > 500) {
      requests.pop();
    }

    renderRequests();
  } catch (err) {
    console.error('Error capturing request:', err);
  }
});

function matchesTypeFilter(resourceType, filterType) {
  if (filterType === 'fetch') {
    return resourceType === 'xhr' || resourceType === 'fetch';
  }
  if (filterType === 'other') {
    const known = ['xhr', 'fetch', 'document', 'stylesheet', 'script', 'font', 'image', 'media', 'manifest', 'websocket', 'wasm'];
    return !known.includes(resourceType);
  }
  return resourceType === filterType;
}

function renderRequests() {
  const filter = filterInput.value.toLowerCase();
  const graphqlOnly = graphqlToggle.checked;
  let regex = null;
  
  try {
    if (filter) {
      regex = new RegExp(filter, 'i');
    }
  } catch (e) {
    // Invalid regex, use simple includes
  }

  const inverted = invertFilter.checked;
  const filtered = requests.filter(req => {
    // Filter by resource type
    if (activeTypeFilter !== 'all') {
      const matches = matchesTypeFilter(req.resourceType, activeTypeFilter);
      if (inverted ? matches : !matches) return false;
    }

    // Filter by GraphQL toggle
    if (graphqlOnly && !req.isGraphQL) {
      return false;
    }

    // Filter by text search
    if (!filter) return true;
    const searchStr = `${req.method} ${req.url}`;
    return regex ? regex.test(searchStr) : searchStr.toLowerCase().includes(filter);
  });

  if (filtered.length === 0) {
    requestsContainer.innerHTML = `
      <div class="empty-state">
        ${requests.length === 0 
          ? 'Requests will appear here. Reload the page to capture traffic.' 
          : 'No requests match the filter.'}
      </div>
    `;
    return;
  }

  requestsContainer.innerHTML = filtered.map((req, i) => {
    const statusClass = req.status < 300 ? 'success' : req.status < 400 ? 'redirect' : 'error';
    const isSelected = selectedIndices.has(requests.indexOf(req));
    
    // Get GraphQL info if available
    let displayText = new URL(req.url).pathname + new URL(req.url).search;
    let graphqlBadge = '';
    
    if (req.isGraphQL) {
      const gqlInfo = parseGraphQLRequest(req.postData);
      if (gqlInfo && gqlInfo.operationName) {
        displayText = `${gqlInfo.operationName} (${gqlInfo.operationType})`;
      }
      graphqlBadge = '<span class="graphql-badge">GQL</span>';
    }
    
    return `
      <div class="request-item ${isSelected ? 'selected' : ''}" data-index="${requests.indexOf(req)}">
        <span class="method ${req.method.toLowerCase()}">${req.method}${graphqlBadge}</span>
        <span class="url" title="${req.url}">${displayText}</span>
        <span class="status-code ${statusClass}">${req.status}</span>
      </div>
    `;
  }).join('');

  // Add click handlers
  requestsContainer.querySelectorAll('.request-item').forEach(el => {
    el.addEventListener('click', (e) => {
      const idx = parseInt(el.dataset.index);

      if (e.shiftKey && lastClickedIndex >= 0) {
        // Shift+click: select range from last clicked to current
        const from = Math.min(lastClickedIndex, idx);
        const to = Math.max(lastClickedIndex, idx);
        if (!e.ctrlKey && !e.metaKey) {
          selectedIndices.clear();
        }
        for (let i = from; i <= to; i++) {
          selectedIndices.add(i);
        }
      } else if (e.ctrlKey || e.metaKey) {
        // Ctrl+click: toggle individual item
        if (selectedIndices.has(idx)) {
          selectedIndices.delete(idx);
        } else {
          selectedIndices.add(idx);
        }
      } else {
        // Plain click: select single item
        selectedIndices.clear();
        selectedIndices.add(idx);
      }

      lastClickedIndex = idx;
      renderRequests();
      updateCopyButton();
      updatePreview();
    });

    el.addEventListener('dblclick', () => {
      const idx = parseInt(el.dataset.index);
      selectedIndices.clear();
      selectedIndices.add(idx);
      lastClickedIndex = idx;
      copySelected();
    });
  });
}

function compactify(obj) {
  if (!compactToggle.checked) return obj;
  return stripNoise(obj);
}

function stripNoise(val) {
  if (val === null || val === undefined || typeof val !== 'object') return val;
  if (Array.isArray(val)) return val.map(stripNoise);
  const result = {};
  for (const [k, v] of Object.entries(val)) {
    if (k === '__typename') continue;
    if (k === 'query' && typeof v === 'string' && (v.trimStart().startsWith('query ') || v.trimStart().startsWith('mutation ') || v.trimStart().startsWith('subscription ') || v.trimStart().startsWith('{'))) continue;
    result[k] = stripNoise(v);
  }
  return result;
}

function formatAsJson(req) {
  const payload = req.postData ? parsePayload(req.postData) : null;
  let responseBody = req.responseBody;

  try {
    responseBody = JSON.parse(req.responseBody);
  } catch (e) {
    // Keep as string
  }

  return JSON.stringify(compactify({
    endpoint: req.url,
    method: req.method,
    status: req.status,
    payload: payload,
    response: responseBody
  }), null, 2);
}

function formatAsCurl(req) {
  let curl = `curl '${req.url}'`;
  
  // Add method if not GET
  if (req.method !== 'GET') {
    curl += ` \\\n  -X ${req.method}`;
  }
  
  // Add headers
  req.headers.forEach(h => {
    if (!['host', 'connection', 'content-length'].includes(h.name.toLowerCase())) {
      curl += ` \\\n  -H '${h.name}: ${h.value}'`;
    }
  });
  
  // Add body
  if (req.postData && req.postData.text) {
    let body = req.postData.text;
    if (compactToggle.checked) {
      try { body = JSON.stringify(compactify(JSON.parse(body))); } catch (e) {}
    }
    curl += ` \\\n  --data-raw '${body}'`;
  }

  // Add response
  let responseBody = req.responseBody;
  try {
    responseBody = JSON.stringify(compactify(JSON.parse(req.responseBody)), null, 2);
  } catch (e) {}

  return `${curl}\n\n# Response (${req.status} ${req.statusText}):\n${responseBody}`;
}

function formatAsMarkdown(req) {
  let payload = req.postData ? parsePayload(req.postData) : null;
  if (payload) payload = compactify(payload);
  let responseBody = req.responseBody;

  try {
    responseBody = JSON.stringify(compactify(JSON.parse(req.responseBody)), null, 2);
  } catch (e) {}

  let md = `## ${req.method} ${new URL(req.url).pathname}\n\n`;
  md += `**URL:** \`${req.url}\`\n\n`;
  md += `**Status:** ${req.status} ${req.statusText}\n\n`;

  if (payload) {
    md += `### Request Payload\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\`\n\n`;
  }

  md += `### Response\n\`\`\`json\n${responseBody}\n\`\`\``;

  return md;
}

function formatAsGraphQL(req) {
  const gqlInfo = parseGraphQLRequest(req.postData);
  
  if (!gqlInfo) {
    // Fallback to JSON if not a valid GraphQL request
    return formatAsJson(req);
  }
  
  let output = '';
  
  // Operation name
  if (gqlInfo.operationName) {
    output += `Operation: ${gqlInfo.operationName}\n`;
  }
  
  // Operation type
  output += `Type: ${gqlInfo.operationType}\n\n`;
  
  // Query (skip in compact mode)
  if (!compactToggle.checked) {
    output += `Query:\n${gqlInfo.query}\n\n`;
  }

  // Variables
  if (gqlInfo.variables) {
    output += `Variables:\n${JSON.stringify(compactify(gqlInfo.variables), null, 2)}\n\n`;
  }

  // Response
  let responseBody = req.responseBody;
  try {
    responseBody = JSON.stringify(compactify(JSON.parse(req.responseBody)), null, 2);
  } catch (e) {
    // Keep as string if not JSON
  }

  output += `Response:\n${responseBody}`;

  return output;
}

function isGraphQLRequest(request) {
  // Check URL for common GraphQL endpoints
  const url = request.url.toLowerCase();
  const isGraphQLEndpoint = 
    url.includes('/graphql') || 
    url.includes('/api/graphql') ||
    url.includes('/gql') ||
    url.includes('/query');
  
  // Check if it's a POST request with JSON body
  if (request.method === 'POST' && request.postData) {
    const body = request.postData.text || '';
    
    // Check Content-Type header
    const contentType = request.headers?.find(h => 
      h.name.toLowerCase() === 'content-type'
    )?.value?.toLowerCase() || '';
    
    if (contentType.includes('application/json') || isGraphQLEndpoint) {
      try {
        const parsed = JSON.parse(body);
        
        // GraphQL requests typically have 'query' or 'mutation' field
        if (parsed.query || parsed.mutation || parsed.subscription) {
          return true;
        }
      } catch (e) {
        // Not JSON, check if it's a raw GraphQL query
        if (body.trim().startsWith('query ') || 
            body.trim().startsWith('mutation ') ||
            body.trim().startsWith('subscription ')) {
          return true;
        }
      }
    }
  }
  
  return false;
}

function parseGraphQLRequest(postData) {
  if (!postData || !postData.text) {
    return null;
  }
  
  try {
    const parsed = JSON.parse(postData.text);
    let query = parsed.query || parsed.mutation || parsed.subscription || '';
    const variables = parsed.variables || null;
    const operationName = parsed.operationName || null;
    
    // Convert escape sequences to actual characters (e.g., \n to newline)
    // This handles cases where the query comes as a JSON string with escaped newlines
    // Sometimes queries have literal \n characters that need to be converted to actual newlines
    if (query && typeof query === 'string') {
      // Check if query has literal \n (backslash + n) but no actual newlines
      // This indicates the escapes weren't processed by JSON.parse
      if (query.includes('\\n')) {
        // Process escapes: handle \\ first to avoid double-processing
        // Replace \\ with a temporary marker
        query = query.replace(/\\\\/g, '\uE000');
        // Now replace escape sequences
        query = query.replace(/\\n/g, '\n');
        query = query.replace(/\\t/g, '\t');
        query = query.replace(/\\r/g, '\r');
        query = query.replace(/\\"/g, '"');
        // Restore escaped backslashes
        query = query.replace(/\uE000/g, '\\');
      }
    }
    
    // Extract operation name from query string if not provided
    let extractedOperationName = operationName;
    if (!extractedOperationName && query) {
      // Match patterns like: query GetUser, mutation CreateUser, subscription OnMessage
      const match = query.match(/(?:query|mutation|subscription)\s+(\w+)/);
      if (match) {
        extractedOperationName = match[1];
      }
    }
    
    // Determine operation type
    let operationType = 'query';
    if (query.trim().startsWith('mutation')) {
      operationType = 'mutation';
    } else if (query.trim().startsWith('subscription')) {
      operationType = 'subscription';
    }
    
    // Format query with basic indentation
    const formattedQuery = formatGraphQLQuery(query);
    
    return {
      operationName: extractedOperationName,
      operationType: operationType,
      query: formattedQuery,
      variables: variables
    };
  } catch (e) {
    // Not JSON, might be raw GraphQL query
    const query = postData.text.trim();
    if (query.startsWith('query ') || query.startsWith('mutation ') || query.startsWith('subscription ')) {
      const match = query.match(/(?:query|mutation|subscription)\s+(\w+)/);
      let operationType = 'query';
      if (query.startsWith('mutation')) {
        operationType = 'mutation';
      } else if (query.startsWith('subscription')) {
        operationType = 'subscription';
      }
      
      return {
        operationName: match ? match[1] : null,
        operationType: operationType,
        query: formatGraphQLQuery(query),
        variables: null
      };
    }
    return null;
  }
}

function formatGraphQLQuery(query) {
  if (!query) return '';
  
  // Basic formatting: add indentation for nested structures
  let formatted = '';
  let indent = 0;
  const indentSize = 2;
  
  // Split by lines and process
  const lines = query.split('\n');
  
  for (let line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      formatted += '\n';
      continue;
    }
    
    // Decrease indent before closing braces
    if (trimmed.startsWith('}')) {
      indent = Math.max(0, indent - indentSize);
    }
    
    // Add indentation
    formatted += ' '.repeat(indent) + trimmed + '\n';
    
    // Increase indent after opening braces
    if (trimmed.endsWith('{') && !trimmed.startsWith('#')) {
      indent += indentSize;
    }
  }
  
  return formatted.trim();
}

function parsePayload(postData) {
  if (!postData) return null;
  
  if (postData.text) {
    try {
      return JSON.parse(postData.text);
    } catch (e) {
      return postData.text;
    }
  }
  
  if (postData.params) {
    const obj = {};
    postData.params.forEach(p => {
      obj[p.name] = p.value;
    });
    return obj;
  }
  
  return null;
}

function formatRequest(req, format) {
  switch (format) {
    case 'curl': return formatAsCurl(req);
    case 'markdown': return formatAsMarkdown(req);
    case 'graphql': return formatAsGraphQL(req);
    default: return formatAsJson(req);
  }
}

async function copySelected() {
  if (selectedIndices.size === 0) {
    showStatus('No request selected', 'error');
    return;
  }

  const format = formatSelect.value;
  const sorted = [...selectedIndices].sort((a, b) => a - b);
  const selected = sorted.map(i => requests[i]).filter(Boolean);

  let text;
  if (selected.length === 1) {
    text = formatRequest(selected[0], format);
  } else if (format === 'json') {
    // Wrap multiple JSON requests in an array
    const items = selected.map(req => {
      const payload = req.postData ? parsePayload(req.postData) : null;
      let responseBody = req.responseBody;
      try { responseBody = JSON.parse(req.responseBody); } catch (e) {}
      return compactify({ endpoint: req.url, method: req.method, status: req.status, payload, response: responseBody });
    });
    text = JSON.stringify(items, null, 2);
  } else {
    // Concatenate with separators
    const separator = format === 'markdown' ? '\n\n---\n\n' : '\n\n';
    text = selected.map(req => formatRequest(req, format)).join(separator);
  }

  const count = selected.length;
  try {
    await navigator.clipboard.writeText(text);
    showStatus(`Copied ${count} request${count > 1 ? 's' : ''}! (${format})`, 'success');
  } catch (err) {
    // Fallback for clipboard API issues in DevTools
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    showStatus(`Copied ${count} request${count > 1 ? 's' : ''}! (${format})`, 'success');
  }
}

function showStatus(message, type = '') {
  statusEl.textContent = message;
  statusEl.className = 'status ' + type;
  
  setTimeout(() => {
    statusEl.textContent = '';
    statusEl.className = 'status';
  }, 2000);
}

// Preview panel logic
function updatePreview() {
  if (selectedIndices.size === 0 || lastClickedIndex < 0 || !requests[lastClickedIndex]) {
    previewPanel.classList.remove('visible');
    mainSplit.classList.remove('has-preview');
    return;
  }

  const req = requests[lastClickedIndex];
  previewPanel.classList.add('visible');
  mainSplit.classList.add('has-preview');

  // Auto-select best tab for this request
  const hasPayload = req.postData && (req.postData.text || req.postData.params);
  if (!hasPayload && activePreviewTab === 'payload') {
    activePreviewTab = 'response';
  }

  // Summary line
  const statusClass = req.status < 300 ? 'success' : req.status < 400 ? 'redirect' : 'error';
  const methodClass = req.method.toLowerCase();
  const multiBadge = selectedIndices.size > 1
    ? `<span class="tab-badge" style="margin-right:4px">${selectedIndices.size} selected</span>`
    : '';
  previewSummary.innerHTML = `
    ${multiBadge}
    <span class="method ${methodClass}">${req.method}</span>
    <span class="url" title="${escapeHtml(req.url)}">${escapeHtml(req.url)}</span>
    <span class="arrow">&rarr;</span>
    <span class="status-code ${statusClass}">${req.status} ${req.statusText}</span>
  `;

  // Update tab badges
  const tabs = previewTabs.querySelectorAll('.preview-tab');
  tabs.forEach(tab => {
    const tabName = tab.dataset.tab;
    tab.classList.toggle('active', tabName === activePreviewTab);

    if (tabName === 'payload') {
      const count = hasPayload ? countKeys(req.postData) : 0;
      tab.innerHTML = `Payload${count ? ` <span class="tab-badge">${count}</span>` : ''}`;
    } else if (tabName === 'headers') {
      const keyHeaders = getKeyHeaders(req);
      tab.innerHTML = `Headers <span class="tab-badge">${keyHeaders.length}</span>`;
    } else {
      tab.innerHTML = 'Response';
    }
  });

  renderPreviewBody(req);
}

function renderPreviewBody(req) {
  switch (activePreviewTab) {
    case 'payload':
      renderPayloadTab(req);
      break;
    case 'response':
      renderResponseTab(req);
      break;
    case 'headers':
      renderHeadersTab(req);
      break;
  }
}

function renderPayloadTab(req) {
  if (!req.postData || (!req.postData.text && !req.postData.params)) {
    previewBody.innerHTML = '<div class="preview-empty">No payload</div>';
    return;
  }

  // For GraphQL, show operation info + variables
  if (req.isGraphQL) {
    const gqlInfo = parseGraphQLRequest(req.postData);
    if (gqlInfo) {
      let html = '';
      if (gqlInfo.operationName) {
        html += `<div class="preview-section-label">Operation</div>`;
        html += `<div>${escapeHtml(gqlInfo.operationName)} <span style="color:#888">(${gqlInfo.operationType})</span></div>`;
      }
      html += `<div class="preview-section-label">Query</div>`;
      html += syntaxHighlightJson(gqlInfo.query, true);
      if (gqlInfo.variables && Object.keys(gqlInfo.variables).length > 0) {
        html += `<div class="preview-section-label">Variables</div>`;
        html += syntaxHighlightJson(JSON.stringify(gqlInfo.variables, null, 2));
      }
      previewBody.innerHTML = html;
      return;
    }
  }

  // Query parameters
  let html = '';
  if (req.queryString && req.queryString.length > 0) {
    html += `<div class="preview-section-label">Query Parameters</div>`;
    req.queryString.forEach(p => {
      html += `<div class="kv-row"><span class="kv-key">${escapeHtml(p.name)}</span><span class="kv-val">${escapeHtml(p.value)}</span></div>`;
    });
  }

  // Body
  html += `<div class="preview-section-label">Body</div>`;
  const payload = parsePayload(req.postData);
  if (typeof payload === 'object' && payload !== null) {
    html += syntaxHighlightJson(JSON.stringify(payload, null, 2));
  } else if (payload) {
    html += `<div>${escapeHtml(String(payload))}</div>`;
  }

  previewBody.innerHTML = html;
}

function renderResponseTab(req) {
  if (!req.responseBody) {
    previewBody.innerHTML = '<div class="preview-empty">No response body</div>';
    return;
  }

  try {
    const parsed = JSON.parse(req.responseBody);
    previewBody.innerHTML = syntaxHighlightJson(JSON.stringify(parsed, null, 2));
  } catch (e) {
    previewBody.textContent = req.responseBody;
  }
}

function renderHeadersTab(req) {
  const keyHeaders = getKeyHeaders(req);

  if (keyHeaders.length === 0) {
    previewBody.innerHTML = '<div class="preview-empty">No notable headers</div>';
    return;
  }

  let html = '';
  let currentSection = '';
  keyHeaders.forEach(h => {
    if (h.section !== currentSection) {
      currentSection = h.section;
      html += `<div class="preview-section-label">${escapeHtml(currentSection)}</div>`;
    }
    html += `<div class="kv-row"><span class="kv-key">${escapeHtml(h.name)}</span><span class="kv-val${h.masked ? ' masked' : ''}">${escapeHtml(h.value)}</span></div>`;
  });

  previewBody.innerHTML = html;
}

function getKeyHeaders(req) {
  const important = [
    'content-type', 'authorization', 'x-api-key', 'x-request-id',
    'x-correlation-id', 'x-trace-id', 'cache-control', 'accept'
  ];
  const sensitivePatterns = ['authorization', 'x-api-key', 'cookie', 'token'];
  const result = [];

  // Request headers
  (req.headers || []).forEach(h => {
    const lower = h.name.toLowerCase();
    const isCustom = lower.startsWith('x-') && !important.includes(lower);
    if (important.includes(lower) || isCustom) {
      const isSensitive = sensitivePatterns.some(p => lower.includes(p));
      result.push({
        section: 'Request',
        name: h.name,
        value: isSensitive ? maskValue(h.value) : h.value,
        masked: isSensitive
      });
    }
  });

  // Response headers (just content-type and cache)
  const respImportant = ['content-type', 'cache-control', 'x-request-id', 'x-correlation-id'];
  (req.responseHeaders || []).forEach(h => {
    const lower = h.name.toLowerCase();
    if (respImportant.includes(lower) || lower.startsWith('x-')) {
      result.push({
        section: 'Response',
        name: h.name,
        value: h.value,
        masked: false
      });
    }
  });

  return result;
}

function maskValue(val) {
  if (!val || val.length <= 8) return '****';
  return val.substring(0, 4) + '****' + val.substring(val.length - 4);
}

function countKeys(postData) {
  if (!postData) return 0;
  if (postData.text) {
    try {
      const parsed = JSON.parse(postData.text);
      return typeof parsed === 'object' ? Object.keys(parsed).length : 1;
    } catch (e) {
      return 1;
    }
  }
  if (postData.params) return postData.params.length;
  return 0;
}

function syntaxHighlightJson(str, raw) {
  if (raw) {
    return `<div>${escapeHtml(str)}</div>`;
  }
  // Highlight JSON keys, strings, numbers, booleans, null
  const highlighted = escapeHtml(str)
    .replace(/"([^"\\]*(\\.[^"\\]*)*)"\s*:/g, '<span class="json-key">"$1"</span>:')
    .replace(/:\s*"([^"\\]*(\\.[^"\\]*)*)"/g, ': <span class="json-string">"$1"</span>')
    .replace(/:\s*(\d+\.?\d*)/g, ': <span class="json-number">$1</span>')
    .replace(/:\s*(true|false)/g, ': <span class="json-boolean">$1</span>')
    .replace(/:\s*(null)/g, ': <span class="json-null">$1</span>');
  return `<div>${highlighted}</div>`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function updateCopyButton() {
  const count = selectedIndices.size;
  copyBtn.disabled = count === 0;
  copyBtn.textContent = count > 1 ? `Copy ${count} Selected` : 'Copy Selected';
}

function scrollSelectedIntoView() {
  const el = requestsContainer.querySelector(`.request-item[data-index="${lastClickedIndex}"]`);
  if (el) el.scrollIntoView({ block: 'nearest' });
}

// Tab click handling
previewTabs.addEventListener('click', (e) => {
  const tab = e.target.closest('.preview-tab');
  if (!tab) return;
  activePreviewTab = tab.dataset.tab;
  previewTabs.querySelectorAll('.preview-tab').forEach(t => t.classList.toggle('active', t === tab));
  if (lastClickedIndex >= 0 && requests[lastClickedIndex]) {
    renderPreviewBody(requests[lastClickedIndex]);
  }
});

// Event listeners
filterInput.addEventListener('input', renderRequests);
graphqlToggle.addEventListener('change', renderRequests);
invertFilter.addEventListener('change', renderRequests);

typeFilterRow.addEventListener('click', (e) => {
  const btn = e.target.closest('.type-btn');
  if (!btn) return;
  activeTypeFilter = btn.dataset.type;
  typeFilterRow.querySelectorAll('.type-btn').forEach(b => b.classList.toggle('active', b === btn));
  renderRequests();
});

copyBtn.addEventListener('click', copySelected);

clearBtn.addEventListener('click', () => {
  requests.length = 0;
  selectedIndices.clear();
  lastClickedIndex = -1;
  updateCopyButton();
  renderRequests();
  updatePreview();
  showStatus('Cleared', 'success');
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  // Ctrl+Shift+C to copy
  if (e.ctrlKey && e.shiftKey && e.key === 'C') {
    e.preventDefault();
    copySelected();
  }
  
  // Arrow keys to navigate
  if (e.key === 'ArrowDown' && lastClickedIndex < requests.length - 1) {
    e.preventDefault();
    lastClickedIndex = lastClickedIndex < 0 ? 0 : lastClickedIndex + 1;
    if (!e.shiftKey) {
      selectedIndices.clear();
    }
    selectedIndices.add(lastClickedIndex);
    renderRequests();
    updateCopyButton();
    updatePreview();
    scrollSelectedIntoView();
  }

  if (e.key === 'ArrowUp' && lastClickedIndex > 0) {
    e.preventDefault();
    lastClickedIndex--;
    if (!e.shiftKey) {
      selectedIndices.clear();
    }
    selectedIndices.add(lastClickedIndex);
    renderRequests();
    updateCopyButton();
    updatePreview();
    scrollSelectedIntoView();
  }
  
  // Enter to copy
  if (e.key === 'Enter' && selectedIndices.size > 0) {
    e.preventDefault();
    copySelected();
  }
});

// Initial render
renderRequests();
