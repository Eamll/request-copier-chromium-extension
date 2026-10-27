const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { test } = require('node:test');

const html = readFileSync(resolve(__dirname, '../panel.html'), 'utf8');
const stylesheet = html.match(/<style>([\s\S]*?)<\/style>/)[1];
const rules = [...stylesheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
function declarations(selector) {
  return rules.find(([, selectors]) => selectors.trim() === selector)[2];
}

test('preview tabs use straight edges for the active underline', () => {
  const tab = declarations('.preview-tab');
  assert.match(tab, /border-radius:\s*0\s*;/);
  assert.match(tab, /border-bottom:\s*2px solid transparent\s*;/);
  assert.match(declarations('.preview-tab.active'), /border-bottom-color:\s*#007acc\s*;/);
});

test('ordinary buttons retain their rounded corners', () => {
  assert.match(declarations('button'), /border-radius:\s*4px\s*;/);
});
