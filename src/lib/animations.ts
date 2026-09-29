import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

// Only import/call this from components that actually animate.
gsap.registerPlugin(ScrollTrigger);

// Simple opt-in reveal: add `data-reveal` to elements.
export function initReveals() {
  const els = gsap.utils.toArray<HTMLElement>("[data-reveal]");
  els.forEach((el) => {
    gsap.from(el, {
      y: 24,
      opacity: 0,
      duration: 0.8,
      ease: "power2.out",
      scrollTrigger: {
        trigger: el,
        start: "top 85%",
      },
    });
  });
}

export { gsap, ScrollTrigger };
