const test = require("node:test");
const assert = require("node:assert/strict");

const { renderLandingPage } = require("../modules/presentation/public-pages");
const { renderQuarantinePage } = require("../modules/presentation/quarantine-page");

test("landing page includes responsive layout safeguards", () => {
  const html = renderLandingPage();

  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1\.0">/);
  assert.match(html, /min-height:\s*100dvh/);
  assert.match(html, /width:\s*min\(100%,\s*640px\)/);
  assert.match(html, /overflow-wrap:\s*anywhere/);
  assert.match(html, /@media\s*\(max-width:\s*640px\)/);
  assert.match(html, /class="install-btn"/);
});

test("quarantine page keeps long text readable on narrow screens", () => {
  const html = renderQuarantinePage({
    eventsRaw: [{
      time: "2026-03-18T21:00:00.000Z",
      ip: "203.0.113.10",
      episodeId: "tt0388629:1:1-super-long-identifier-that-should-wrap-on-mobile-widths",
      error: "upstream timeout with very long detail that should wrap instead of clipping"
    }],
    maxSessions: 50,
    activeCount: 12,
    slotTaken: 4,
    resolutionErrors: 2
  });

  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1\.0">/);
  assert.match(html, /class="table-wrap"/);
  assert.match(html, /overflow-x:\s*auto/);
  assert.match(html, /overflow-wrap:\s*anywhere/);
  assert.match(html, /word-break:\s*break-word/);
  assert.match(html, /@media\s*\(max-width:\s*640px\)/);
  assert.doesNotMatch(html, /203\.0\.113\.10/);
});
