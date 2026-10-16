const query = new URLSearchParams(window.location.search);
const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
const isHomePath = ["/", "/index.html"].includes(
  window.location.pathname.replace(/\/+$/, "") || "/",
);
const hasInvitationParameters = Boolean(query.get("wedding")) || Boolean(fragment.get("guest"));

if (isHomePath && !hasInvitationParameters && query.get("demo") !== "1") {
  window.location.replace("./dashboard-login.html");
}
