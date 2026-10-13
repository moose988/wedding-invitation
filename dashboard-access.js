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
