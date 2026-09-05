/* ─── NAV SEARCH ───────────────────────────────────────────────
   Type-ahead over the entry metadata emitted by pages/search-index.njk.
   Styling lives in input.css (.nav-search*); the markup is the macro at the
   top of eleventy_settings/nav.njk, rendered once for the desktop bar and once
   inside the mobile menu. Both instances share one index.

   Two constraints shape everything here.

   1. The site has to run from a file:// path, so the index is pulled in with a
      <script> tag. fetch() and XMLHttpRequest are both blocked by CORS on
      file:// in Chrome, which is also what rules out Pagefind, lunr and every
      other off-the-shelf static-search library — they all fetch their index.

   2. Nothing loads until the box is focused. A reader who never searches pays
      nothing for the feature, which is what keeps the design honest as the
      library grows: at 5,000 entries the index is ~1.5 MB, and it still costs
      a page load exactly zero.

   With JavaScript off none of this exists — a <noscript> rule in nav.njk
   removes the box entirely, and the nav is what it was before.
   ───────────────────────────────────────────────────────────── */
(function () {
'use strict';

var forms = document.querySelectorAll('.nav-search');
if (!forms.length) return;

var MAX_RESULTS = 8;      // rows in the panel; the rest go to the full index
var DESC_MAX    = 96;     // description clamp — one line per row

// Index state, shared by every box on the page.
var rows    = null;       // the index, once loaded
var loading = false;      // a <script> is in flight
var failed  = false;      // it 404'd or threw
var waiting = [];         // renderers to run when it settles, either way

// ── Text ───────────────────────────────────────────────────────────────────

/* The same fold lib/search.js applied when building the index: strip accents,
   lowercase. Both sides must agree or "mecanique" would miss "Mécanique". */
function normalise(text) {
    return String(text == null ? '' : text)
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
}

/* Titles and descriptions are arbitrary user content out of YAML front matter.
   Every string below is assembled into innerHTML, so nothing reaches it
   without passing through here first. */
function esc(text) {
    return String(text == null ? '' : text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/* Wrap the matched run in <mark>. The offset comes from the normalised string
   but the slices are taken from the original, so escaping has to happen per
   fragment, afterwards — escaping first would let a title containing "&" shift
   every offset past it. NFKD can also change length (and so can lowercasing,
   for a handful of characters), and then the offsets do not line up at all;
   the guard drops back to plain escaped text rather than cutting in the wrong
   place and corrupting the title. */
function highlight(text, needle) {
    var plain = normalise(text);
    if (!needle || plain.length !== text.length) return esc(text);
    var at = plain.indexOf(needle);
    if (at < 0) return esc(text);
    return esc(text.slice(0, at)) +
           '<mark>' + esc(text.slice(at, at + needle.length)) + '</mark>' +
           esc(text.slice(at + needle.length));
}

function clamp(text, limit) {
    var str = String(text == null ? '' : text);
    return str.length <= limit ? str : str.slice(0, limit).replace(/\s+\S*$/, '') + '…';
}

// ── Scoring ────────────────────────────────────────────────────────────────

/* Anything that can start a word, so "bottle" scores as a word in
   "Water bottle" and in "water-bottle" alike, but not inside "waterbottle". */
var WORD_START = /[\s\-–—_\/(,.:]/;

/* Every token has to hit somewhere, so "compost tea" cannot match an entry
   that only knows about compost. Within a token the best hit wins, and the
   weights are only an ordering: a title you have started typing beats a title
   that merely contains the word, which beats a tag, which beats a passing
   mention in the summary. */
function scoreRow(row, tokens) {
    var title = normalise(row.t);
    var desc  = normalise(row.d);
    var total = 0;

    for (var i = 0; i < tokens.length; i++) {
        var token = tokens[i];
        var at = title.indexOf(token);
        var best = 0;

        if (at === 0) best = 100;                                       // title starts with it
        else if (at > 0 && WORD_START.test(title.charAt(at - 1))) best = 60;  // starts a word in the title
        else if (at > 0) best = 40;                                     // buried in the title
        else if (row.k.indexOf(token) >= 0) best = 25;                  // tag, category or author
        else if (desc.indexOf(token) >= 0) best = 10;                   // summary only

        if (!best) return 0;
        total += best;
    }
    return total;
}

/* A linear scan. At 220 rows it is microseconds and at 5,000 a couple of
   milliseconds — well inside the gap between two keystrokes, so there is no
   debounce and the results never lag behind what has been typed. */
function search(query) {
    var tokens = normalise(query).split(/\s+/).filter(Boolean);
    if (!tokens.length) return { hits: [], token: '' };

    var hits = [];
    for (var i = 0; i < rows.length; i++) {
        var score = scoreRow(rows[i], tokens);
        if (score) hits.push({ row: rows[i], score: score, at: i });
    }

    // Ties fall back to index order, which lib/search.js emits newest-first.
    hits.sort(function (a, b) { return b.score - a.score || a.at - b.at; });
    return { hits: hits, token: tokens[0] };
}

// ── Loading ────────────────────────────────────────────────────────────────

function settle() {
    loading = false;
    var pending = waiting;
    waiting = [];
    for (var i = 0; i < pending.length; i++) pending[i]();
}

/* A <script> tag, not fetch() — see the note at the top. The load event is
   what we wait on rather than anything the index file announces itself: load
   fires AFTER the script has executed, so window.__SEARCH_INDEX__ is
   guaranteed to be there by the time it does.

   Guarded three ways, because both boxes call this and focus can fire more
   than once: already loaded, already failed, already in flight. */
function loadIndex(src, onDone) {
    if (rows || failed) { onDone(); return; }
    // Deduped by identity, because render() now asks on every keystroke typed
    // while the index is in flight. One stable closure per box, so one entry.
    if (waiting.indexOf(onDone) < 0) waiting.push(onDone);
    if (loading) return;
    loading = true;

    var script = document.createElement('script');
    script.src = src;
    script.addEventListener('load', function () {
        rows = window.__SEARCH_INDEX__ || [];
        settle();
    });
    script.addEventListener('error', function () {
        failed = true;
        settle();
    });
    document.head.appendChild(script);
}

// ── One search box ─────────────────────────────────────────────────────────

var closers = [];

function wire(form) {
    var input  = form.querySelector('.nav-search__input');
    var panel  = form.querySelector('.nav-search__panel');
    var list   = form.querySelector('.nav-search__results');
    var listId = list.id;
    var allUrl = form.dataset.all || '';
    var cursor = -1;       // highlighted row; -1 is the input itself
    var options = [];

    // The index holds root-relative URLs because one copy of it serves pages
    // at every depth. data-root is how far up this page sits — "." when the
    // page IS the root, in which case there is nothing to prefix.
    var root = form.dataset.root || '.';
    var prefix = root === '.' ? '' : root.replace(/\/+$/, '') + '/';

    function open() {
        panel.hidden = false;
        input.setAttribute('aria-expanded', 'true');
    }

    /* The list is emptied, not merely hidden. Enter falls back to the first row
       when nothing is highlighted, so markup left behind by the previous query
       stayed reachable with the panel shut: Escape cleared the box, and the
       next Enter navigated to a result that was no longer on screen and no
       longer matched anything the reader had typed. */
    function close() {
        panel.hidden = true;
        input.setAttribute('aria-expanded', 'false');
        input.removeAttribute('aria-activedescendant');
        list.innerHTML = '';
        options = [];
        cursor = -1;
    }

    /* role="presentation" because the <ul> is a listbox, and a listbox may only
       contain options. A status line is not something you can choose. */
    function message(text) {
        list.innerHTML = '<li class="nav-search__message" role="presentation">' +
                             esc(text) + '</li>';
        options = [];
        cursor = -1;
        input.removeAttribute('aria-activedescendant');
        open();
    }

    function render() {
        var query = input.value.trim();
        if (!query) return close();
        if (failed)  return message('Search is unavailable.');
        // Focus is the usual trigger, but it can be missed altogether: this
        // script is deferred while the box is revealed during head parsing, so
        // a reader can focus and start typing before the listener below is
        // wired, and that focus never comes back. The request is idempotent,
        // so asking again here costs nothing and is the only thing standing
        // between that reader and a panel stuck on "Searching…" for good.
        if (!rows) { loadIndex(form.dataset.index, render); return message('Searching…'); }

        var found = search(query);
        if (!found.hits.length) return message('No entries match “' + query + '”.');

        var shown = found.hits.slice(0, MAX_RESULTS);
        var html = '';

        for (var i = 0; i < shown.length; i++) {
            var row = shown[i].row;
            html += '<li class="nav-search__item" role="option" aria-selected="false"' +
                        ' id="' + esc(listId) + '-' + i + '">' +
                      '<a class="nav-search__link" href="' + esc(prefix + row.u) + '" tabindex="-1">' +
                        '<span class="nav-search__title">' + highlight(row.t, found.token) + '</span>' +
                        (row.g ? '<span class="nav-search__context">' + esc(row.g) + '</span>' : '') +
                        (row.d ? '<span class="nav-search__desc">' + esc(clamp(row.d, DESC_MAX)) + '</span>' : '') +
                      '</a>' +
                    '</li>';
        }

        // A query with more matches than fit always has somewhere to go. The
        // full index is the fallback this whole feature sits on top of.
        if (found.hits.length > shown.length && allUrl) {
            html += '<li class="nav-search__more" role="presentation">' +
                      '<a href="' + esc(allUrl) + '" tabindex="-1">' +
                        (found.hits.length - shown.length) + ' more — see the full index' +
                      '</a></li>';
        }

        list.innerHTML = html;
        options = list.querySelectorAll('.nav-search__item');
        cursor = -1;
        input.removeAttribute('aria-activedescendant');
        open();
    }

    /* Arrow keys cycle through options.length + 1 positions: the input itself,
       then every row. Shifting by one turns that into plain modulo over a
       range starting at 0, so both ends wrap without a special case. */
    function move(step) {
        var count = options.length;
        if (!count) return;
        if (cursor >= 0) options[cursor].setAttribute('aria-selected', 'false');

        cursor = (cursor + 1 + step + count + 1) % (count + 1) - 1;

        if (cursor < 0) {
            input.removeAttribute('aria-activedescendant');
            return;
        }
        var option = options[cursor];
        option.setAttribute('aria-selected', 'true');
        input.setAttribute('aria-activedescendant', option.id);
        // 'nearest' so arrowing down a long list keeps the highlighted row on
        // screen without yanking the panel to the top or bottom.
        if (option.scrollIntoView) option.scrollIntoView({ block: 'nearest' });
    }

    // Focus is the trigger, not the first keystroke: by the time a character
    // has been typed the index has usually already arrived. It is not the only
    // trigger — render() asks too, for the focus this never sees.
    input.addEventListener('focus', function () {
        loadIndex(form.dataset.index, render);
    }, { once: true });

    input.addEventListener('input', render);

    input.addEventListener('keydown', function (event) {
        if (event.key === 'ArrowDown')    { event.preventDefault(); move(1); }
        else if (event.key === 'ArrowUp') { event.preventDefault(); move(-1); }
        else if (event.key === 'Escape')  { input.value = ''; close(); }
        else if (event.key === 'Enter') {
            // Handled here rather than on submit so the highlighted row wins
            // over the first one.
            // Gated on the panel being open: with nothing on screen there is
            // nothing on offer, and Enter belongs to the form handler below.
            var link = panel.hidden ? null
                : cursor >= 0 ? options[cursor].querySelector('a')
                              : list.querySelector('.nav-search__link');
            if (link) { event.preventDefault(); window.location.href = link.href; }
        }
    });

    // The action attribute is what happens if this script never loads. With it
    // running, Enter on a query that matched nothing goes to the full index
    // rather than reloading the current page with a ?q= nothing can read.
    form.addEventListener('submit', function (event) {
        event.preventDefault();
        if (allUrl) window.location.href = allUrl;
    });

    closers.push(function (target) { if (!form.contains(target)) close(); });
}

for (var i = 0; i < forms.length; i++) wire(forms[i]);

// Click rather than blur: blur fires before the click lands on a result, so
// closing on blur would hide the very row being clicked.
document.addEventListener('click', function (event) {
    for (var i = 0; i < closers.length; i++) closers[i](event.target);
});

}());
