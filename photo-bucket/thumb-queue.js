// Loads thumbnails one by one: at most `concurrency` requests in flight, only for photos the
// page asks for (those near the viewport). Asking again for a key that is queued or running
// does nothing; cancelling a queued key removes it, so photos that scrolled away never load.
export function createThumbQueue({ load, concurrency = 4 }) {
  const waiting = new Map(), running = new Set();
  const pump = () => {
    while (running.size < concurrency && waiting.size) {
      const [key, job] = waiting.entries().next().value;
      waiting.delete(key); running.add(key);
      Promise.resolve().then(load.bind(null, key, job.item)).then(job.done, job.fail).finally(() => { running.delete(key); pump(); });
    }
  };
  return {
    request(key, item, done, fail = () => {}) { if (waiting.has(key) || running.has(key)) return; waiting.set(key, { item, done, fail }); pump(); },
    cancel(key) { return waiting.delete(key); },
    clear() { waiting.clear(); },
    stats: () => ({ waiting: waiting.size, running: running.size }),
  };
}

// A small least-recently-used cache so a long scroll never holds every thumbnail in memory.
export function createLru(max = 300) {
  const map = new Map();
  return {
    get(key) { if (!map.has(key)) return undefined; const value = map.get(key); map.delete(key); map.set(key, value); return value; },
    set(key, value) { map.delete(key); map.set(key, value); while (map.size > max) map.delete(map.keys().next().value); },
    has: key => map.has(key), get size() { return map.size; },
  };
}
