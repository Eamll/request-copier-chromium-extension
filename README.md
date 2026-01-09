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

## Notes

- The extension only captures requests made **after** opening DevTools
- Reload the page after opening DevTools to capture all requests
