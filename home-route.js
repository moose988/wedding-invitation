const query = new URLSearchParams(window.location.search);
const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
const isHomePath = ["/", "/index.html"].includes(
  window.location.pathname.replace(/\/+$/, "") || "/",
);
const invitationQueryKeys = ["wedding", "guest", "recipient", "sample"];
const invitationHashKeys = ["guest", "recipient"];
const hasInvitationContext =
  invitationQueryKeys.some((key) => query.has(key)) ||
  invitationHashKeys.some((key) => fragment.has(key));

if (isHomePath && !hasInvitationContext && query.get("demo") !== "1") {
  window.location.replace(`./customer-login.html${window.location.search}${window.location.hash}`);
}
