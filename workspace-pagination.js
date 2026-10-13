export function paginateRows(rows, requestedPage = 1, pageSize = 6) {
  const size = Math.max(1, Math.floor(Number(pageSize) || 6));
  const pageCount = Math.max(1, Math.ceil(rows.length / size));
  const page = Math.min(Math.max(1, Math.floor(Number(requestedPage) || 1)), pageCount);
  const start = (page - 1) * size;

  return {
    items: rows.slice(start, start + size),
    page,
    pageCount,
    start,
  };
}
