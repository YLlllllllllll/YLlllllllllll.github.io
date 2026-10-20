/* Page-level behaviour: navigation, reveal, filters, and reading progress. */
(() => {
  document.documentElement.classList.add("js");

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const progressBar = document.getElementById("scroll-progress-bar");
  const navLinks = Array.from(document.querySelectorAll(".nav a[href^='#']"));
  const watchedSections = navLinks
    .map((link) => document.querySelector(link.getAttribute("href")))
    .filter(Boolean);

  function updateScrollState() {
    const scrollable = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    const progress = Math.min(1, Math.max(0, window.scrollY / scrollable));
    if (progressBar) progressBar.style.transform = `scaleX(${progress})`;

    const probe = window.scrollY + window.innerHeight * 0.34;
    let activeId = "";
    for (const section of watchedSections) {
      if (section.offsetTop <= probe) activeId = section.id;
    }
    for (const link of navLinks) {
      link.classList.toggle("is-active", link.getAttribute("href") === `#${activeId}`);
    }
  }

  let scrollTicking = false;
  window.addEventListener("scroll", () => {
    if (scrollTicking) return;
    scrollTicking = true;
    requestAnimationFrame(() => {
      updateScrollState();
      scrollTicking = false;
    });
  }, { passive: true });
  updateScrollState();

  const filterButtons = Array.from(document.querySelectorAll(".filter-chip"));
  const signalCards = Array.from(document.querySelectorAll(".signal-card"));
  filterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const filter = button.dataset.filter || "all";
      filterButtons.forEach((item) => {
        const active = item === button;
        item.classList.toggle("is-active", active);
        item.setAttribute("aria-pressed", String(active));
      });
      signalCards.forEach((card) => {
        card.classList.toggle("is-filtered", filter !== "all" && card.dataset.field !== filter);
      });
    });
  });

  const revealTargets = [
    ...document.querySelectorAll(".section-head"),
    ...document.querySelectorAll(".signal-card"),
    ...document.querySelectorAll(".source-desk"),
    ...document.querySelectorAll(".atlas-live"),
    ...document.querySelectorAll(".atlas-shell"),
    ...document.querySelectorAll(".atlas-map"),
    ...document.querySelectorAll(".atlas-footnote"),
    ...document.querySelectorAll(".matrix-shell"),
    ...document.querySelectorAll(".game-shell"),
    ...document.querySelectorAll(".impact-card"),
    ...document.querySelectorAll(".timeline-item"),
    ...document.querySelectorAll(".profile-card"),
    ...document.querySelectorAll(".contact .section-index, .contact h2, .contact-copy, .contact-links"),
  ];

  if (reduced || !("IntersectionObserver" in window)) {
    revealTargets.forEach((element) => element.classList.add("reveal", "is-revealed"));
  } else {
    revealTargets.forEach((element) => element.classList.add("reveal"));
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-revealed");
        observer.unobserve(entry.target);
      }
    }, { threshold: 0.08, rootMargin: "0px 0px -6% 0px" });
    revealTargets.forEach((element) => observer.observe(element));
  }
})();
