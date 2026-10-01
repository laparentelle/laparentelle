// Vanilla scroll animation. Only import/call this from components that
// actually animate — there is no animation library anymore on purpose
// (a 46 KB GSAP bundle for fades was the largest unused-JS offender).

/** Fade-slide reveal: add `data-reveal` to elements (see global.css). */
export function initReveals() {
  const els = Array.from(
    document.querySelectorAll<HTMLElement>("[data-reveal]"),
  );
  if (els.length === 0) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (!("IntersectionObserver" in window)) {
    for (const el of els) el.classList.add("is-visible");
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          (entry.target as HTMLElement).classList.add("is-visible");
          io.unobserve(entry.target);
        }
      }
    },
    // Roughly the old "top 85%" trigger: reveal once ~15% is visible.
    { rootMargin: "0px 0px -15% 0px" },
  );
  for (const el of els) io.observe(el);
}

/**
 * Hero parallax: drift `.hero-bg` down as the hero scrolls out.
 * One rAF-batched read/write per frame — no forced reflow.
 */
export function initHeroParallax() {
  const bg = document.querySelector<HTMLElement>(".hero-blok .hero-bg");
  const hero = bg?.closest<HTMLElement>(".hero-blok");
  if (!bg || !hero) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  let height = Math.max(1, hero.offsetHeight);
  let ticking = false;
  const update = () => {
    ticking = false;
    const progress = Math.min(1, Math.max(0, window.scrollY / height));
    // Same 0 → 18% range as the previous scrubbed tween.
    bg.style.transform =
      "translate3d(0," + (progress * 18).toFixed(3) + "%,0)";
  };
  window.addEventListener(
    "scroll",
    () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    },
    { passive: true },
  );
  window.addEventListener("resize", () => {
    height = Math.max(1, hero.offsetHeight);
    update();
  });
  // No transform before the first scroll: writing one during load would put
  // a needless style mutation (and a potential layout-shift entry) in the
  // critical window. At scrollY 0 the transform is the identity anyway.
  if (window.scrollY > 0) update();
}
