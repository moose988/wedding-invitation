// Customer login motion layer: ambient loops, pointer parallax, tap-to-open art,
// and purely visual feedback on the sign-in form. It never touches auth logic:
// it only reads the DOM, adds CSS classes, and listens passively (no preventDefault).
(() => {
  "use strict";

  const root = document.documentElement;
  const body = document.body;
  if (!body || body.dataset.accountSurface !== "customer") return;

  const reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const art = document.querySelector(".planner-login__art");
  const seal = document.querySelector(".planner-login__wax-seal");
  const form = document.getElementById("loginForm");
  const submit = document.getElementById("loginSubmitButton");
  const status = document.getElementById("authStatus");
  const card = document.querySelector(".planner-login__card");

  const COLORS = ["#c29a5b", "#3c6d7a", "#e3b49d", "#98b39c", "#ead9b6"];
  const SHAPES = ["strip", "dot", "petal"];
  const compactQuery = window.matchMedia("(max-width: 700px)");
  const ENTRANCE_MS = compactQuery.matches ? 2500 : 3500;
  const rand = (min, max) => min + Math.random() * (max - min);
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const reduced = () => reducedQuery.matches;

  function restartClass(element, className, duration) {
    if (!element || reduced()) return;
    element.classList.remove(className);
    void element.offsetWidth; // restart the CSS animation
    element.classList.add(className);
    window.setTimeout(() => element.classList.remove(className), duration);
  }

  // ---- Ambient drifting confetti -------------------------------------------------
  let drift = null;
  function buildDrift() {
    if (!art || drift) return;
    drift = document.createElement("div");
    drift.className = "clm-drift";
    drift.setAttribute("aria-hidden", "true");
    const count = window.innerWidth < 600 ? 7 : 13;
    for (let i = 0; i < count; i += 1) {
      const piece = document.createElement("span");
      piece.className = "clm-drift__piece";
      piece.dataset.shape = pick(SHAPES);
      piece.style.setProperty("--x", `${((i + rand(0.15, 0.85)) / count) * 100}%`);
      piece.style.setProperty("--d", `${rand(9, 15).toFixed(2)}s`);
      piece.style.setProperty("--delay", `${(-rand(0, 15)).toFixed(2)}s`);
      piece.style.setProperty("--dx", `${rand(-36, 36).toFixed(0)}px`);
      piece.style.setProperty("--r", `${rand(25, 70).toFixed(0)}deg`);
      piece.style.setProperty("--f", `${rand(1.8, 3.4).toFixed(2)}s`);
      piece.style.setProperty("--c", pick(COLORS));
      piece.appendChild(document.createElement("i"));
      drift.appendChild(piece);
    }
    art.appendChild(drift);
    sizeDrift();
  }

  function sizeDrift() {
    if (drift && art) drift.style.setProperty("--fall", `${Math.round(art.offsetHeight * 1.08)}px`);
  }

  // ---- Bursts --------------------------------------------------------------------
  function burst(host, x, y, count, spread) {
    if (!host || reduced()) return;
    const layer = document.createElement("div");
    layer.className = "clm-burst";
    layer.setAttribute("aria-hidden", "true");
    layer.style.left = `${x}px`;
    layer.style.top = `${y}px`;
    let longest = 0;
    for (let i = 0; i < count; i += 1) {
      const angle = (-Math.PI / 2) + rand(-1.35, 1.35);
      const distance = rand(spread * 0.45, spread);
      const duration = rand(750, 1150);
      longest = Math.max(longest, duration);
      const piece = document.createElement("span");
      piece.className = "clm-burst__piece";
      piece.dataset.shape = pick(SHAPES);
      piece.style.setProperty("--bx", `${(Math.cos(angle) * distance).toFixed(1)}px`);
      piece.style.setProperty("--by", `${(Math.sin(angle) * distance).toFixed(1)}px`);
      piece.style.setProperty("--br", `${rand(-420, 420).toFixed(0)}deg`);
      piece.style.setProperty("--d", `${duration.toFixed(0)}ms`);
      piece.style.setProperty("--c", pick(COLORS));
      layer.appendChild(piece);
    }
    host.appendChild(layer);
    window.setTimeout(() => layer.remove(), longest + 120);
  }

  // ---- Pointer parallax / tilt ----------------------------------------------------
  let target = { x: 0, y: 0 };
  const current = { x: 0, y: 0 };
  let frame = 0;

  function renderTilt() {
    current.x += (target.x - current.x) * 0.09;
    current.y += (target.y - current.y) * 0.09;
    art.style.setProperty("--clm-px", current.x.toFixed(4));
    art.style.setProperty("--clm-py", current.y.toFixed(4));
    if (Math.abs(target.x - current.x) > 0.001 || Math.abs(target.y - current.y) > 0.001) {
      frame = window.requestAnimationFrame(renderTilt);
    } else {
      frame = 0;
    }
  }

  function aimAt(clientX, clientY, reach) {
    if (!art || reduced()) return;
    const rect = art.getBoundingClientRect();
    const nx = (clientX - (rect.left + rect.width / 2)) / (reach || rect.width / 2);
    const ny = (clientY - (rect.top + rect.height / 2)) / (reach || rect.height / 2);
    target = { x: Math.max(-1, Math.min(1, nx)), y: Math.max(-1, Math.min(1, ny)) };
    if (!frame) frame = window.requestAnimationFrame(renderTilt);
  }

  function settleTilt() {
    target = { x: 0, y: 0 };
    if (!frame && art) frame = window.requestAnimationFrame(renderTilt);
  }

  function bindTilt() {
    if (!art) return;
    if (finePointer) {
      window.addEventListener("pointermove", (event) => {
        if (event.pointerType === "mouse") aimAt(event.clientX, event.clientY, window.innerWidth / 2);
      }, { passive: true });
      document.documentElement.addEventListener("pointerleave", settleTilt, { passive: true });
    }
    art.addEventListener("pointerdown", (event) => {
      if (event.pointerType !== "mouse") aimAt(event.clientX, event.clientY);
    }, { passive: true });
    art.addEventListener("pointermove", (event) => {
      if (event.pointerType !== "mouse") aimAt(event.clientX, event.clientY);
    }, { passive: true });
    ["pointerup", "pointercancel", "pointerleave"].forEach((type) => {
      art.addEventListener(type, (event) => {
        if (event.pointerType !== "mouse") settleTilt();
      }, { passive: true });
    });
  }

  // ---- Tap the envelope / seal to open it ------------------------------------------
  function bindArtTap() {
    if (!art) return;
    art.addEventListener("click", () => {
      if (reduced()) return;
      goLive();
      const opening = !art.classList.contains("clm-open");
      art.classList.toggle("clm-open", opening);
      if (opening && seal) {
        const artRect = art.getBoundingClientRect();
        const sealRect = seal.getBoundingClientRect();
        const x = sealRect.left + sealRect.width / 2 - artRect.left;
        const y = sealRect.top + sealRect.height / 2 - artRect.top;
        burst(art, x, y, window.innerWidth < 600 ? 14 : 20, window.innerWidth < 600 ? 90 : 130);
      }
    });
  }

  // ---- Form feedback (visual only) ---------------------------------------------------
  function bindForm() {
    if (form) {
      form.addEventListener("invalid", (event) => {
        const field = event.target instanceof Element ? event.target.closest(".planner-login__field") : null;
        restartClass(field, "clm-shake", 460);
      }, true);
    }

    if (submit) {
      submit.addEventListener("pointerdown", (event) => {
        if (submit.disabled || reduced()) return;
        const rect = submit.getBoundingClientRect();
        const ripple = document.createElement("span");
        ripple.className = "clm-ripple";
        ripple.setAttribute("aria-hidden", "true");
        ripple.style.left = `${event.clientX - rect.left}px`;
        ripple.style.top = `${event.clientY - rect.top}px`;
        submit.appendChild(ripple);
        window.setTimeout(() => ripple.remove(), 700);
      }, { passive: true });
    }

    // Phones: when a field gains focus (and the keyboard opens), make sure the
    // Sign in button is still reachable above the keyboard. Scroll only; no focus change.
    if (form && submit && window.visualViewport) {
      let keyboardTimer = 0;
      form.addEventListener("focusin", (event) => {
        if (!compactQuery.matches || !(event.target instanceof HTMLInputElement)) return;
        window.clearTimeout(keyboardTimer);
        keyboardTimer = window.setTimeout(() => {
          const viewport = window.visualViewport;
          const overflow = submit.getBoundingClientRect().bottom + 12 - (viewport.offsetTop + viewport.height);
          if (overflow > 0) window.scrollBy({ top: overflow, behavior: reduced() ? "auto" : "smooth" });
        }, 320);
      });
    }

    if (status && "MutationObserver" in window) {
      new MutationObserver(() => {
        const text = status.textContent.trim();
        if (!text) return;
        restartClass(status, "clm-status-pop", 460);
        if (/^Opening /.test(text)) celebrate();
        else if (/^Sign-in failed/.test(text)) restartClass(card, "clm-card-shake", 560);
      }).observe(status, { childList: true, characterData: true, subtree: true });
    }
  }

  function celebrate() {
    body.classList.add("clm-success");
    if (!submit || !card || reduced()) return;
    const cardRect = card.getBoundingClientRect();
    const buttonRect = submit.getBoundingClientRect();
    burst(card, buttonRect.left + buttonRect.width / 2 - cardRect.left, buttonRect.top - cardRect.top + 8, 22, 150);
  }

  // ---- Lifecycle: start loops after the entrance, pause when unseen ----------------
  let live = false;
  function goLive() {
    if (live || reduced()) return;
    live = true;
    buildDrift();
    root.classList.add("clm-live");
  }

  function bindVisibility() {
    document.addEventListener("visibilitychange", () => {
      root.classList.toggle("clm-tab-hidden", document.hidden);
    });
    if (art && "IntersectionObserver" in window) {
      new IntersectionObserver((entries) => {
        entries.forEach((entry) => root.classList.toggle("clm-art-off", !entry.isIntersecting));
      }, { rootMargin: "40px" }).observe(art);
    }
    let resizeTimer = 0;
    window.addEventListener("resize", () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(sizeDrift, 150);
    }, { passive: true });
  }

  function start() {
    bindForm();
    if (reduced()) return;
    bindTilt();
    bindArtTap();
    bindVisibility();
    const startedAt = performance.now();
    window.setTimeout(goLive, Math.max(0, ENTRANCE_MS - startedAt));
  }

  reducedQuery.addEventListener?.("change", () => {
    if (reduced()) {
      root.classList.remove("clm-live");
      if (art) {
        art.classList.remove("clm-open");
        art.style.removeProperty("--clm-px");
        art.style.removeProperty("--clm-py");
      }
    }
  });

  start();
})();
