/* ─── READING-WIDTH TOGGLE ─────────────────────────────────────
   Injects a corner button that narrows the article column by cycling a
   --reading-scale CSS variable (see .post-container in input.css).

   Everything is created here, so with JS disabled the button simply does
   not exist and the layout is unaffected (--reading-scale falls back to 1).
   The button is hidden until the pointer enters the lower-right corner zone;
   styling lives in input_prose.css (.reading-corner-zone / .reading-width-btn).

   Ported from website_v3_014/javascript/reading_width.js. Two differences:
   the outline control here is a <label class="article-outline-label">, not a
   <button class="article-outline-btn">; and the choice is remembered across
   pages, because an encyclopaedia is many short pages rather than one long
   article and re-setting the width on every entry would make the button
   useless. The value is restored before first paint by a one-liner in
   eleventy_settings/base.njk — doing it from here would let the column paint
   full width and then visibly jump.
   ───────────────────────────────────────────────────────────── */
(function () {
'use strict';

// Only run on pages that actually have the markdown post column. It is also
// where the controls get appended below, so keep the reference.
var column = document.querySelector('.post-container');
if (!column) return;

// Desktop-only: skip entirely on touch devices. maxTouchPoints/ontouchstart is a
// more reliable "is this a touch device" signal than the (hover)/(pointer) media
// queries, which some mobile browsers misreport — letting a long-press reveal the
// button. Never creating the elements means nothing can reveal them.
if (navigator.maxTouchPoints > 0 || 'ontouchstart' in window) return;

var SCALES  = [1, 0.75, 0.55, 0.40, 0.28, 0.18];  // default → 75% → 55% → 40% → 28% → 18% of default width
var STORAGE = 'reading-scale';
var NARROW  = '><';                   // shown while there's still room to narrow
var WIDEN   = '<>';                   // shown at the narrowest step: next press widens back
var index   = 0;                      // current step in SCALES

// '<>' only at the last (narrowest) step, where the next click returns to default.
function glyphFor(i) { return i === SCALES.length - 1 ? WIDEN : NARROW; }

// Recover the step from the stored scale rather than storing the index, so the
// one-liner in <head> only has to setProperty and never has to know this list.
// An unrecognised value (left over from a different set of steps) falls back to
// the default instead of leaving the glyph out of step with the layout.
try {
    var saved = SCALES.indexOf(parseFloat(localStorage.getItem(STORAGE)));
    if (saved > 0) index = saved;
} catch (e) { /* localStorage can throw in private-browsing modes */ }

// Transparent hover target in the very corner (reveals the button on hover).
var zone = document.createElement('div');
zone.className = 'reading-corner-zone';

// The button itself.
var btn = document.createElement('button');
btn.type = 'button';
btn.className = 'reading-width-btn';
btn.setAttribute('aria-label', 'Narrow the reading width');
btn.setAttribute('title', 'Narrow the reading width');
btn.textContent = glyphFor(index);

// Sit above the outline button when the post has one; otherwise use the corner slot.
if (document.querySelector('.article-outline-label')) {
    btn.classList.add('reading-width-btn--above-outline');
}

btn.addEventListener('click', function () {
    index = (index + 1) % SCALES.length;
    document.documentElement.style.setProperty('--reading-scale', SCALES[index]);
    btn.textContent = glyphFor(index);
    try {
        if (index === 0) localStorage.removeItem(STORAGE);
        else localStorage.setItem(STORAGE, SCALES[index]);
    } catch (e) { /* storage full or blocked — the toggle still works this page */ }
});

// Insert into the SAME stacking context as the outline button — which means
// inside .post-container, not merely somewhere on the page. .post-container
// carries .extra_fade_effect (an opacity animation), so it forms its own
// stacking context: the outline label's z-index 120 is scoped to the inside of
// it, and the column as a whole paints as one unit at z-index 0 among its own
// siblings. Appending the zone anywhere outside — document.body, or
// .bg-topology-map — therefore paints it above the entire column whatever its
// z-index, and the zone (which cannot be pointer-events: none, it needs :hover)
// swallows every click on the outline button beneath it. Inside the column the
// declared order finally holds: zone 110 < panel 119 < label 120 < button 121.
// Order matters too: the zone must precede the button so the CSS
// `.reading-corner-zone:hover ~ .reading-width-btn` sibling selector works.
column.appendChild(zone);
column.appendChild(btn);

}());
