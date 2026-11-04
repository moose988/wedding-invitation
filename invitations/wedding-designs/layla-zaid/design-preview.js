// Keep the alternate design opt-in for preview URLs.
if (new URLSearchParams(location.search).get("design") === "a") {
  document.documentElement.classList.add("design-a");
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = "./invitations/wedding-designs/layla-zaid/design-a.css";
  document.head.append(stylesheet);
}
