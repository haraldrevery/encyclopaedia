/* ─── HOMEPAGE NAV REVEAL (fallback) ───────────────────────────
   The nav bar is hidden at the top of the homepage and scrubs into place as
   the reader scrolls toward the section menu. Where the browser supports
   scroll-driven animations that whole effect is done in CSS with
   `animation-timeline: scroll()` (see the .nav-reveal block in input.css) and
   this file returns immediately.

   It exists for the browsers that do not, which as of writing still includes
   Firefox — scroll-driven animations are behind
   layout.css.scroll-driven-animations.enabled there. Without this the bar
   would simply stay visible on the homepage: correct, but not the effect.

   Ported from website_v3_014/javascript/navbar_scroll.js, with three
   differences. That one toggles a binary threshold at scrollY > 50 while its
   CSS scrubs across 50vh, so the two paths disagree about when the bar
   arrives; this one scrubs, matching `animation-range: 0 50vh` exactly. It
   guards against a missing element rather than throwing on any page that
   forgets the class. And it honours prefers-reduced-motion, which the
   reference does not — the bar stays put for a reader who asked for no
   motion, matching the !important rule in the stylesheet.

   The .nav-reveal-js class this pairs with is set by an inline one-liner in
   base.njk rather than here, so the bar is never painted visible and then
   yanked away. Same reasoning as the `js` class and the reading-scale
   restore that sit alongside it.
   ───────────────────────────────────────────────────────────── */
(function () {
'use strict';

// The CSS path is live — nothing to do. Mirrors the @supports condition.
if (window.CSS && CSS.supports && CSS.supports('animation-timeline: scroll()')) return;

if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;

var nav = document.querySelector('.nav-reveal');
if (!nav) return;

// Matches animation-range: 0 50vh — fully revealed half a screen down.
var RANGE = 0.5;
var queued = false;

function paint() {
  queued = false;
  var range = window.innerHeight * RANGE;
  // range is 0 on a zero-height viewport; guard so this cannot divide by zero.
  var p = range > 0 ? Math.min(1, window.scrollY / range) : 1;
  nav.style.opacity = p;
  nav.style.transform = 'translateY(' + (p - 1) * 110 + '%)';
}

// Scroll fires far more often than the screen repaints; coalesce to one
// write per frame rather than laying out on every event.
function onScroll() {
  if (queued) return;
  queued = true;
  window.requestAnimationFrame(paint);
}

// Straight away as well as on scroll: a reload restores the previous scroll
// position, and the bar has to match it before the first frame is shown.
paint();
window.addEventListener('scroll', onScroll, { passive: true });
window.addEventListener('resize', onScroll, { passive: true });

})();
