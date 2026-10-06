(() => {
  const toggle = document.getElementById("navToggle");
  const nav = document.getElementById("nav");
  const setMenu = (open) => {
    document.body.classList.toggle("nav-open", open);
    toggle?.setAttribute("aria-expanded", String(open));
    toggle?.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
  };

  toggle?.addEventListener("click", () => setMenu(toggle.getAttribute("aria-expanded") !== "true"));
  nav?.addEventListener("click", (event) => {
    if (event.target.closest("a")) setMenu(false);
  });
  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-retry]")) {
      window.startDirectHomesApp?.();
      return;
    }
    if (document.body.classList.contains("nav-open") && !event.target.closest("#nav, #navToggle")) setMenu(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setMenu(false);
  });
  window.addEventListener("hashchange", () => {
    setMenu(false);
    window.startDirectHomesApp?.();
  });

  const year = document.getElementById("currentYear");
  if (year) year.textContent = new Date().getFullYear();
  window.startDirectHomesApp?.();
})();
