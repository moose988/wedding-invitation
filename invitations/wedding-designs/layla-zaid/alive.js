/* Small living touches for the Layla & Zaid invitation: drifting petals, twinkling stars, tap sparkles.
   Everything is decorative, skipped for reduced-motion guests, and starts only once the invitation is open. */
(function () {
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) return;
  var started = false;

  function el(tag, cls, vars) {
    var n = document.createElement(tag);
    n.className = cls;
    for (var k in vars) n.style.setProperty(k, vars[k]);
    return n;
  }
  var rnd = function (a, b) { return a + Math.random() * (b - a); };

  function startAmbient() {
    if (started) return;
    started = true;
    var layer = el("div", "alive-petals", {});
    layer.setAttribute("aria-hidden", "true");
    for (var i = 0; i < 9; i++) {
      layer.appendChild(el("span", "alive-petal", {
        "--x": rnd(0, 100).toFixed(1) + "%", "--s": rnd(8, 14).toFixed(1) + "px", "--d": rnd(20, 34).toFixed(1) + "s",
        "--delay": (-rnd(0, 30)).toFixed(1) + "s", "--drift": rnd(-120, 120).toFixed(0) + "px", "--spin": rnd(200, 520).toFixed(0) + "deg"
      }));
    }
    document.body.appendChild(layer);
    document.addEventListener("visibilitychange", function () { layer.style.display = document.hidden ? "none" : ""; });

    var content = document.querySelector("#heroSection .hero-paper__content");
    if (content) {
      [[8, 22, 14, 0], [88, 16, 10, 1.1], [14, 60, 9, 2.2], [84, 52, 13, 0.6], [50, 6, 11, 1.7]].forEach(function (p) {
        content.appendChild(el("i", "alive-star", { "--l": p[0] + "%", "--t": p[1] + "%", "--sz": p[2] + "px", "--delay": p[3] + "s" }));
      });
    }
  }

  function check() {
    if (document.body && document.body.classList.contains("invitation-open")) { startAmbient(); return true; }
    return false;
  }
  function init() {
    if (check()) return;
    var obs = new MutationObserver(function () { if (check()) obs.disconnect(); });
    obs.observe(document.body, { attributes: true, attributeFilter: ["class"] });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();



  // RSVP reply: a few gold sparkles for "yes", a few soft petals drifting down for "no".
  function rsvpReply() {
    var summary = document.querySelector("#rsvpMount .rsvp-summary");
    var mark = summary && summary.querySelector(".rsvp-confirmation-mark");
    if (!mark) return false;
    var yes = summary.classList.contains("rsvp-summary--confirmed");
    var box = mark.getBoundingClientRect(), cx = box.left + box.width / 2, cy = box.top + box.height / 2;
    for (var i = 0; i < (yes ? 16 : 6); i++) {
      var n, rot = rnd(-200, 200).toFixed(0) + "deg";
      if (yes) {
        var a = (Math.PI * 2 * i) / 16 + rnd(-0.2, 0.2), r = rnd(60, 130);
        n = el("span", "rsvp-spark", { "--dx": Math.cos(a) * r + "px", "--dy": Math.sin(a) * r + "px", "--rot": rot, "--sz": rnd(7, 14).toFixed(0) + "px" });
        n.style.animationDelay = rnd(0, 0.25).toFixed(2) + "s";
      } else {
        n = el("span", "rsvp-drift", { "--dx": rnd(-70, 70).toFixed(0) + "px", "--rot": rot });
        n.style.animationDelay = (i * 0.35).toFixed(2) + "s";
      }
      n.style.left = cx + "px"; n.style.top = cy + "px";
      document.body.appendChild(n);
      setTimeout(function (c) { c.remove(); }, 4200, n);
    }
    return true;
  }
  document.addEventListener("submit", function (e) {
    if (!e.target.closest || !e.target.closest("#rsvpMount")) return;
    var tries = 0, timer = setInterval(function () {
      if (rsvpReply() || ++tries > 40) clearInterval(timer);
    }, 100);
  }, true);

  // Tiny gold sparkle where a guest taps a button or choice.
  document.addEventListener("pointerdown", function (e) {
    var t = e.target.closest && e.target.closest(".luxury-button, .rsvp-answer, .detail-tab, .music-toggle");
    if (!t) return;
    for (var i = 0; i < 7; i++) {
      var a = (Math.PI * 2 * i) / 7 + rnd(-0.3, 0.3), r = rnd(22, 40);
      var s = el("span", "alive-spark", { "--dx": Math.cos(a) * r + "px", "--dy": Math.sin(a) * r + "px" });
      s.style.left = e.clientX + "px"; s.style.top = e.clientY + "px";
      document.body.appendChild(s);
      setTimeout(function (n) { n.remove(); }, 750, s);
    }
  }, { passive: true });
})();
