# Privacy Policy — Network Request Copier

**Last updated: 17 August 2026**

Network Request Copier is a Chrome DevTools extension that lets a developer copy
the details of network requests made by the page they are inspecting.

## Summary

**This extension does not collect, store, transmit, or sell any user data.**

It has no servers, no analytics, no telemetry, and no network code of any kind.
Nothing ever leaves your computer.

## What the extension accesses

While Chrome DevTools is open, the extension receives network request metadata
for the inspected tab through the standard `chrome.devtools.network` API. This
can include request URLs, HTTP methods, status codes, request headers, request
bodies, response headers, and response bodies — the same information already
visible to you in the built-in DevTools **Network** panel.

## How that information is handled

- It is held **only in the memory of the DevTools panel**, in a list capped at
  500 requests.
- It is **discarded when you close DevTools**, reload the panel, or click
  **Clear List**. Nothing is written to disk, to `chrome.storage`, to
  `localStorage`, or to any database.
- It is **never transmitted anywhere**. The extension contains no `fetch`, no
  `XMLHttpRequest`, and no other network calls. It declares no host permissions
  and, in fact, declares no permissions at all in its manifest.
- It is written to your system clipboard **only when you explicitly ask for it**
  by pressing the copy shortcut, pressing Enter, double-clicking a request, or
  clicking the **Copy Selected** button.

## Data you copy is your responsibility

When you copy a request, the copied text may contain sensitive values that were
present in that request — for example `Authorization` headers, cookies, API
keys, session tokens, or personal information contained in a response body. The
extension places this text on your clipboard and does nothing further with it.

Please review what you have copied before pasting it into a bug report, a chat
message, a support ticket, or any third-party tool.

## No remote code

All of the extension's code is contained in the published package. It loads no
external scripts, stylesheets, fonts, or WebAssembly modules, and it does not
use `eval()` or any other form of dynamic code execution.

## Third parties

There are none. No data is shared with, sold to, or transferred to any third
party, for any purpose.

## Children's privacy

The extension is a developer tool and is not directed at children. It collects
no data from anyone, including children.

## Changes to this policy

If this policy changes, the updated version will be published at this same URL
with a revised "Last updated" date.

## Contact

Questions about this policy can be raised as an issue at
<https://github.com/Eamll/request-copier-chromium-extension/issues>.
