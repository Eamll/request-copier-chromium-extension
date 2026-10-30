# Network Request Copier

A Chrome DevTools extension that lets you copy network request details (endpoint, payload, and response) with a single hotkey.

## Installation

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in the top right)
3. Click **Load unpacked**
4. Select this folder (`network-copy-extension`)
5. Open DevTools (F12) on any page - you'll see a new **"Request Copier"** tab

## Usage

1. Open DevTools and go to the **Request Copier** tab
2. Reload the page to start capturing requests
3. Click on a request to select it
4. Press **Ctrl+Shift+C** to copy (or click the Copy button)

### GraphQL operation names

The request list shows names such as `GetUser (query)` or `SaveUser (mutation)` instead of just `/graphql`. Names come from `operationName` or the query text, for JSON POST bodies, raw GraphQL bodies, and GET query parameters. Batched requests show the available names separated by commas.

Persisted queries that send `operationName` without query text show the name without guessing the operation type. Anonymous operations use the first root field as a list label, for example `query ($status: BookStatus!, $library_ids: [ID!]) { books(status: $status, library_ids: $library_ids) { book_id } }` shows `books (query)`, and `{ authors { name } }` shows `authors (query)`. Aliases use the underlying field name. This display label is searchable but does not add an operation name to the query or copied output. If no root field can be identified, the endpoint is kept. Hover over a row to see its full label and URL.

Use the **GraphQL** toggle to show only GraphQL requests. The text filter searches operation names as well as methods and URLs, with regex support.

The **Payload** preview highlights GraphQL keywords, names, variables, directives, strings, numbers, booleans, null, and comments. Query whitespace and copied output stay unchanged. Variables and responses keep their JSON highlighting.

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+C` | Copy selected request |
| `↑` / `↓` | Navigate requests |
| `Enter` | Copy selected request |
| Double-click | Copy request |

### Output Formats

Choose from three formats in the dropdown:

**JSON** (default):
```json
{
  "endpoint": "https://api.example.com/users",
  "method": "POST",
  "status": 200,
  "payload": { "name": "John" },
  "response": { "id": 1, "name": "John" }
}
```

**cURL + Response**:
```bash
curl 'https://api.example.com/users' \
  -X POST \
  -H 'Content-Type: application/json' \
  --data-raw '{"name":"John"}'

# Response (200 OK):
{"id": 1, "name": "John"}
```

**Markdown**:
```markdown
## POST /users

**URL:** `https://api.example.com/users`
**Status:** 200 OK

### Request Payload
{json payload}

### Response
{json response}
```

## Features

- Captures XHR/Fetch and JSON API requests automatically
- Filter requests with regex support
- Dark theme matching DevTools
- Stores up to 500 requests per session
- Multiple output formats

## Tests

Run the capture, list, filter, and copy regression tests with Node.js 18 or newer. No dependencies are required.

```bash
node --test tests/*.test.cjs
```

## Notes

- The extension only captures requests made **after** opening DevTools
- Reload the page after opening DevTools to capture all requests
