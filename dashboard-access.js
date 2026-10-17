export function canViewSeatingAccountPage(view, permissions = {}) {
  switch (view) {
    case "overview":
    case "guests":
      return permissions.canViewDashboard === true;
    case "seating":
      return permissions.canEditSeating === true;
    case "settings":
      return permissions.canEditEventDetails === true || permissions.canManageUsers === true;
    default:
      return false;
  }
}

export function resolveSeatingAccountPage(requestedView, permissions = {}) {
  const preferredView = requestedView || "seating";
  if (canViewSeatingAccountPage(preferredView, permissions)) return preferredView;
  return canViewSeatingAccountPage("seating", permissions) ? "seating" : "overview";
}

export function canViewDashboardPage(view, permissions = {}) {
  const allowedViews = permissions.allowedViews;
  if (Array.isArray(allowedViews) && (
    permissions.canViewDashboard !== true ||
    !allowedViews.includes(view)
  )) return false;
  if (view === "exports" && Array.isArray(allowedViews) && permissions.canExport !== true) return false;
  if (permissions.seatingOnly === true) {
    return canViewSeatingAccountPage(view, permissions);
  }
  if (view === "settings") {
    return permissions.canViewEventSettings === true ||
      permissions.canEditEventDetails === true ||
      permissions.canManageUsers === true;
  }
  return ["overview", "guestSummary", "guests", "seating", "share", "exports", "checkin"].includes(view);
}

export function resolveDashboardPage(requestedView, permissions = {}) {
  const preferredView = requestedView || "overview";
  if (canViewDashboardPage(preferredView, permissions)) return preferredView;
  if (canViewDashboardPage("overview", permissions)) return "overview";
  return canViewDashboardPage("seating", permissions) ? "seating" : "overview";
}
