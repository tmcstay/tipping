import assert from "node:assert/strict";
import test from "node:test";

import { escapeHtml } from "./htmlEscape.ts";

test("escapeHtml escapes all HTML-significant characters", () => {
  assert.equal(
    escapeHtml(`<script>alert("x")</script> & 'quote'`),
    "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;quote&#39;"
  );
});

test("escapeHtml leaves plain text unchanged", () => {
  assert.equal(escapeHtml("Jordan Smith"), "Jordan Smith");
});

test("escapeHtml handles an empty string", () => {
  assert.equal(escapeHtml(""), "");
});
