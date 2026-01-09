// Store all captured requests
const requests = [];
let selectedIndex = -1;

// DOM elements
const requestsContainer = document.getElementById('requests');
const filterInput = document.getElementById('filter');
const formatSelect = document.getElementById('format');
const copyBtn = document.getElementById('copyBtn');
const clearBtn = document.getElementById('clearBtn');
const statusEl = document.getElementById('status');
const graphqlToggle = document.getElementById('graphqlToggle');

// Listen for network requests
chrome.devtools.network.onRequestFinished.addListener(async (request) => {
  // Only capture XHR/Fetch requests (skip images, css, etc)
  const type = request._resourceType || request.response.content.mimeType;
  const isApiCall = 
    type === 'xhr' || 
    type === 'fetch' ||
    request.response.content.mimeType?.includes('json') ||
    request.response.content.mimeType?.includes('text/plain');
  
  if (!isApiCall && !request.request.url.includes('/api/')) {
    // Also include anything with /api/ in the URL
    if (!request.response.content.mimeType?.includes('json')) {
      return;
    }
  }

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

  const filtered = requests.filter(req => {
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
    const isSelected = requests.indexOf(req) === selectedIndex;
    
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
    el.addEventListener('click', () => {
      selectedIndex = parseInt(el.dataset.index);
      renderRequests();
      copyBtn.disabled = false;
    });

    el.addEventListener('dblclick', () => {
      selectedIndex = parseInt(el.dataset.index);
      copySelected();
    });
  });
}

function formatAsJson(req) {
  const payload = req.postData ? parsePayload(req.postData) : null;
  let responseBody = req.responseBody;
  
  try {
    responseBody = JSON.parse(req.responseBody);
  } catch (e) {
    // Keep as string
  }

  return JSON.stringify({
    endpoint: req.url,
    method: req.method,
    status: req.status,
    payload: payload,
    response: responseBody
  }, null, 2);
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
    curl += ` \\\n  --data-raw '${req.postData.text}'`;
  }

  // Add response
  let responseBody = req.responseBody;
  try {
    responseBody = JSON.stringify(JSON.parse(req.responseBody), null, 2);
  } catch (e) {}

  return `${curl}\n\n# Response (${req.status} ${req.statusText}):\n${responseBody}`;
}

function formatAsMarkdown(req) {
  const payload = req.postData ? parsePayload(req.postData) : null;
  let responseBody = req.responseBody;
  
  try {
    responseBody = JSON.stringify(JSON.parse(req.responseBody), null, 2);
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
  
  // Query
  output += `Query:\n${gqlInfo.query}\n\n`;
  
  // Variables
  if (gqlInfo.variables) {
    output += `Variables:\n${JSON.stringify(gqlInfo.variables, null, 2)}\n\n`;
  }
  
  // Response
  let responseBody = req.responseBody;
  try {
    responseBody = JSON.stringify(JSON.parse(req.responseBody), null, 2);
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

async function copySelected() {
  if (selectedIndex < 0 || !requests[selectedIndex]) {
    showStatus('No request selected', 'error');
    return;
  }

  const req = requests[selectedIndex];
  const format = formatSelect.value;
  
  let text;
  switch (format) {
    case 'curl':
      text = formatAsCurl(req);
      break;
    case 'markdown':
      text = formatAsMarkdown(req);
      break;
    case 'graphql':
      text = formatAsGraphQL(req);
      break;
    default:
      text = formatAsJson(req);
  }

  try {
    await navigator.clipboard.writeText(text);
    showStatus(`Copied! (${format})`, 'success');
  } catch (err) {
    // Fallback for clipboard API issues in DevTools
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    showStatus(`Copied! (${format})`, 'success');
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

// Event listeners
filterInput.addEventListener('input', renderRequests);
graphqlToggle.addEventListener('change', renderRequests);

copyBtn.addEventListener('click', copySelected);

clearBtn.addEventListener('click', () => {
  requests.length = 0;
  selectedIndex = -1;
  copyBtn.disabled = true;
  renderRequests();
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
  if (e.key === 'ArrowDown' && selectedIndex < requests.length - 1) {
    e.preventDefault();
    selectedIndex++;
    renderRequests();
    copyBtn.disabled = false;
  }
  
  if (e.key === 'ArrowUp' && selectedIndex > 0) {
    e.preventDefault();
    selectedIndex--;
    renderRequests();
    copyBtn.disabled = false;
  }
  
  // Enter to copy
  if (e.key === 'Enter' && selectedIndex >= 0) {
    e.preventDefault();
    copySelected();
  }
});

// Initial render
renderRequests();
