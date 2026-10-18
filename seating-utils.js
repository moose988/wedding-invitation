export function resolveTableName(table, fallback = "Table") {
  const currentName = String(table?.name || "").trim();
  if (currentName) return currentName;
  const legacyName = String(table?.label || "").trim();
  return legacyName || fallback;
}

export function summarizePartySeating(guest, assignments = []) {
  const extraCount = Number(guest?.additionalGuests);
  const requiredCount =
    1 + (Number.isInteger(extraCount) && extraCount > 0 ? extraCount : 0);
  const assignedPeople = new Set();

  assignments.forEach((assignment, index) => {
    const explicitIndex = Number(assignment?.partyMemberIndex);
    const keyedIndex = String(assignment?.personKey || "").match(
      /^(?:main|guest-(\d+))$/,
    );
    const memberIndex = Number.isInteger(explicitIndex) && explicitIndex >= 0
      ? explicitIndex
      : assignment?.personKey === "main"
        ? 0
        : keyedIndex?.[1]
          ? Number(keyedIndex[1])
          : index;
    if (memberIndex < requiredCount) assignedPeople.add(memberIndex);
  });

  const assignedCount = assignedPeople.size;
  return {
    requiredCount,
    assignedCount,
    remainingCount: Math.max(0, requiredCount - assignedCount),
    complete: assignedCount >= requiredCount,
  };
}

export function assignmentsForGuest(assignments, guestId) {
  const normalizedId = String(guestId || "");
  if (!normalizedId) return [];
  return assignments.filter(
    (assignment) => String(assignment?.guestId || "") === normalizedId,
  );
}

export function normalizeTableShape(shape) {
  switch (String(shape || "round").toLowerCase()) {
    case "rectangle":
    case "conference":
    case "long-banquet":
      return "rectangle";
    case "square":
      return "square";
    case "u-shape":
    case "open-u":
    case "horseshoe":
      return "u-shape";
    default:
      return "round";
  }
}

export function defaultTableWidth(shape) {
  switch (normalizeTableShape(shape)) {
    case "rectangle": return 230;
    case "u-shape": return 220;
    case "square": return 170;
    default: return 180;
  }
}

export function defaultTableHeight(shape) {
  switch (normalizeTableShape(shape)) {
    case "rectangle": return 140;
    case "u-shape": return 180;
    case "square": return 170;
    default: return 180;
  }
}

export function getContrastingTextColor(color) {
  const match = String(color || "").match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return "#fffdf8";
  const raw = match[1].length === 3
    ? match[1].split("").map((part) => part + part).join("")
    : match[1];
  const channels = [0, 2, 4].map((index) => parseInt(raw.slice(index, index + 2), 16) / 255);
  const linear = channels.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  return luminance > 0.48 ? "#26352f" : "#fffdf8";
}

function ellipseCircumference(width, height) {
  const a = width / 2;
  const b = height / 2;
  const h = ((a - b) / (a + b)) ** 2;
  return Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
}

function segmentSeatCounts(lengths, count, pitch, cornerMargin) {
  const usable = lengths.map((length) => Math.max(0, length - cornerMargin * 2));
  const capacities = usable.map((length) => Math.max(0, Math.floor(length / pitch) - 1));
  const result = lengths.map(() => 0);
  for (let seat = 0; seat < count; seat += 1) {
    let target = -1;
    for (let index = 0; index < lengths.length; index += 1) {
      if (result[index] >= capacities[index]) continue;
      if (target < 0 || (result[index] + 1) / usable[index] < (result[target] + 1) / usable[target]) target = index;
    }
    if (target < 0) return null;
    result[target] += 1;
  }
  return result;
}

/** Return normalized chair centers and outward-facing angles for dashboard and invitation rendering. */
export function buildChairPositions(shape, seatCount, width = 180, height = 180) {
  const count = Math.max(0, Math.floor(Number(seatCount) || 0));
  if (!count) return [];
  const tableWidth = Math.max(1, Number(width) || defaultTableWidth(shape));
  const tableHeight = Math.max(1, Number(height) || defaultTableHeight(shape));
  const chairSize = 34;
  const gap = 8;
  const minimumOffset = chairSize / 2 + 10;
  const shapeName = normalizeTableShape(shape);

  if (shapeName === "round") {
    let offset = minimumOffset;
    const targetPerimeter = count * (chairSize + gap);
    offset = Math.max(offset, (targetPerimeter - ellipseCircumference(tableWidth, tableHeight)) / (2 * Math.PI));
    const radiusX = tableWidth / 2 + offset;
    const radiusY = tableHeight / 2 + offset;
    return Array.from({ length: count }, (_, index) => {
      const angle = -Math.PI / 2 + (index / count) * Math.PI * 2;
      const dx = Math.cos(angle) * radiusX;
      const dy = Math.sin(angle) * radiusY;
      return {
        x: 50 + (dx / tableWidth) * 100,
        y: 50 + (dy / tableHeight) * 100,
        rotation: (Math.atan2(dy, dx) * 180) / Math.PI + 90,
      };
    });
  }

  if (shapeName === "u-shape") {
    let offset = minimumOffset;
    const pitch = chairSize + gap;
    const cornerMargin = chairSize / Math.SQRT2;
    let outerWidth;
    let sideLength;
    let counts;
    do {
      outerWidth = tableWidth + 2 * offset;
      sideLength = tableHeight + 2 * offset;
      counts = segmentSeatCounts([outerWidth, sideLength, sideLength], count, pitch, cornerMargin);
      if (!counts) offset += pitch / 2;
    } while (!counts);
    const [topCount, rightCount, leftCount] = counts;
    const sideStart = -offset;
    const points = [];
    for (let index = 0; index < topCount; index += 1) {
      const x = -offset + cornerMargin + ((index + 1) / (topCount + 1)) * (outerWidth - cornerMargin * 2);
      points.push({ x, y: -offset, rotation: 0 });
    }
    for (let index = 0; index < rightCount; index += 1) {
      const y = sideStart + cornerMargin + ((index + 1) / (rightCount + 1)) * (sideLength - cornerMargin * 2);
      points.push({ x: tableWidth + offset, y, rotation: 90 });
    }
    for (let index = 0; index < leftCount; index += 1) {
      const y = sideStart + cornerMargin + ((index + 1) / (leftCount + 1)) * (sideLength - cornerMargin * 2);
      points.push({ x: -offset, y, rotation: 270 });
    }
    return points.map(({ x, y, rotation }) => ({
      x: (x / tableWidth) * 100,
      y: (y / tableHeight) * 100,
      rotation,
    }));
  }

  let offset = minimumOffset;
  const pitch = chairSize + gap;
  const cornerMargin = chairSize / Math.SQRT2;
  let outerWidth;
  let outerHeight;
  let counts;
  do {
    outerWidth = tableWidth + 2 * offset;
    outerHeight = tableHeight + 2 * offset;
    counts = segmentSeatCounts([outerWidth, outerHeight, outerWidth, outerHeight], count, pitch, cornerMargin);
    if (!counts) offset += pitch / 2;
  } while (!counts);
  const [topCount, rightCount, bottomCount, leftCount] = counts;
  const points = [];
  const addSide = (sideCount, pointAt, rotation) => {
    for (let index = 0; index < sideCount; index += 1) {
      const t = (index + 1) / (sideCount + 1);
      points.push({ ...pointAt(t), rotation });
    }
  };
  addSide(topCount, (t) => ({ x: -offset + cornerMargin + t * (outerWidth - cornerMargin * 2), y: -offset }), 0);
  addSide(rightCount, (t) => ({ x: tableWidth + offset, y: -offset + cornerMargin + t * (outerHeight - cornerMargin * 2) }), 90);
  addSide(bottomCount, (t) => ({ x: tableWidth + offset - cornerMargin - t * (outerWidth - cornerMargin * 2), y: tableHeight + offset }), 180);
  addSide(leftCount, (t) => ({ x: -offset, y: tableHeight + offset - cornerMargin - t * (outerHeight - cornerMargin * 2) }), 270);
  return points.map(({ x, y, rotation }) => ({
    x: (x / tableWidth) * 100,
    y: (y / tableHeight) * 100,
    rotation,
  }));
}

export function generateTableChairs(shape, seatCount, width, height, previousChairs = [], tableId = "table") {
  const existing = Array.isArray(previousChairs) ? previousChairs : [];
  return buildChairPositions(shape, seatCount, width, height).map((position, index) => {
    const seatNumber = index + 1;
    const previous = existing.find((chair) => Number(chair.seatNumber) === seatNumber) || existing[index] || {};
    return {
      id: previous.id || `${tableId}-chair-${seatNumber}`,
      seatNumber,
      guestId: previous.guestId || "",
      assignment: previous.assignment || null,
      status: previous.status || "available",
      x: position.x,
      y: position.y,
      rotation: position.rotation,
      notes: previous.notes || "",
      vip: Boolean(previous.vip),
    };
  });
}

export function buildSeatAssignmentKeys(assignments = []) {
  return new Set(assignments
    .filter((assignment) => assignment?.tableId && assignment?.seatNumber !== undefined && assignment?.seatNumber !== "")
    .map((assignment) => `${assignment.tableId}::${assignment.seatNumber}`));
}

export function getSeatPlanFrameBounds(tables, assignments, canvasWidth = 1100, canvasHeight = 900, clearance = 28) {
  const tablesById = new Map(tables.map((table) => [String(table.id), table]));
  const positionCache = new Map();
  const points = assignments.flatMap((assignment) => {
    const table = tablesById.get(String(assignment.tableId));
    if (!table) return [];
    const width = Number(table.width || defaultTableWidth(table.shape));
    const height = Number(table.height || defaultTableHeight(table.shape));
    const radians = (Number(table.rotation || 0) * Math.PI) / 180;
    const centerX = (Number(table.x ?? 50) / 100) * canvasWidth;
    const centerY = (Number(table.y ?? 50) / 100) * canvasHeight;
    if (!positionCache.has(table.id)) {
      const count = table.chairs?.length || table.seatCount || table.capacity || 0;
      positionCache.set(table.id, buildChairPositions(table.shape, count, width, height));
    }
    const chair = table.chairs?.find((item) => String(item.seatNumber) === String(assignment.seatNumber));
    const seatIndex = Math.max(0, Number(assignment.seatNumber) - 1);
    const position = chair && chair.x !== null && chair.x !== undefined && chair.y !== null && chair.y !== undefined && Number.isFinite(Number(chair.x)) && Number.isFinite(Number(chair.y))
      ? chair
      : positionCache.get(table.id)[seatIndex];
    if (!position) return [];
    const localX = (position.x / 100) * width - width / 2;
    const localY = (position.y / 100) * height - height / 2;
    return [{
      x: centerX + localX * Math.cos(radians) - localY * Math.sin(radians),
      y: centerY + localX * Math.sin(radians) + localY * Math.cos(radians),
    }];
  });
  if (!points.length) return null;
  return {
    minX: Math.min(...points.map((point) => point.x)) - clearance,
    maxX: Math.max(...points.map((point) => point.x)) + clearance,
    minY: Math.min(...points.map((point) => point.y)) - clearance,
    maxY: Math.max(...points.map((point) => point.y)) + clearance,
  };
}

/** Bounds the assigned chairs together with their tables, in rendered canvas coordinates. */
export function getSeatPlanFocusBounds(tables, assignments, canvasWidth = 1100, canvasHeight = 900, chairSize = 34, padding = 20) {
  const tablesById = new Map(tables.map((table) => [String(table.id), table]));
  const boxes = [];
  const addBox = (centerX, centerY, width, height) => boxes.push({
    minX: centerX - width / 2,
    maxX: centerX + width / 2,
    minY: centerY - height / 2,
    maxY: centerY + height / 2,
  });

  assignments.forEach((assignment) => {
    const table = tablesById.get(String(assignment?.tableId));
    if (!table) return;
    const width = Number(table.width || defaultTableWidth(table.shape));
    const height = Number(table.height || defaultTableHeight(table.shape));
    const centerX = (Number(table.x ?? 50) / 100) * canvasWidth;
    const centerY = (Number(table.y ?? 50) / 100) * canvasHeight;
    const tableRotation = (Number(table.rotation || 0) * Math.PI) / 180;
    const chair = table.chairs?.find((item) => String(item.seatNumber) === String(assignment.seatNumber));
    const chairPositions = buildChairPositions(
      table.shape,
      table.chairs?.length || table.seatCount || table.capacity || 0,
      width,
      height,
    );
    const position = chair && chair.x !== null && chair.x !== undefined && chair.y !== null && chair.y !== undefined && Number.isFinite(Number(chair.x)) && Number.isFinite(Number(chair.y))
      ? chair
      : chairPositions[Math.max(0, Number(assignment.seatNumber) - 1)];
    if (!position) return;
    const halfWidth = (Math.abs(Math.cos(tableRotation)) * width + Math.abs(Math.sin(tableRotation)) * height) / 2;
    const halfHeight = (Math.abs(Math.sin(tableRotation)) * width + Math.abs(Math.cos(tableRotation)) * height) / 2;
    addBox(centerX, centerY, halfWidth * 2, halfHeight * 2);
    const localX = (Number(position.x) / 100) * width - width / 2;
    const localY = (Number(position.y) / 100) * height - height / 2;
    const chairX = centerX + localX * Math.cos(tableRotation) - localY * Math.sin(tableRotation);
    const chairY = centerY + localX * Math.sin(tableRotation) + localY * Math.cos(tableRotation);
    addBox(chairX, chairY, chairSize, chairSize);
  });

  if (!boxes.length) return null;
  return {
    minX: Math.min(...boxes.map((box) => box.minX)) - padding,
    maxX: Math.max(...boxes.map((box) => box.maxX)) + padding,
    minY: Math.min(...boxes.map((box) => box.minY)) - padding,
    maxY: Math.max(...boxes.map((box) => box.maxY)) + padding,
  };
}
