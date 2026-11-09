import { AdminError, bearerFrom, readBody, sendError } from './_lib/admin-common.js';
import { beginEventRestore, exportEventPage, finishEventRestore, startEventExport, writeEventRestorePage } from './_lib/event-backup.js';
import { adminServices } from './_lib/firebase-admin-app.js';

// Platform administrators only. Download: export-start, then export-page per section.
// Restore: restore-begin until done, restore-write per page, then restore-finish.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' });
  try {
    const token = bearerFrom(req);
    const { action, eventId, path, cursor, docs, event, cards, grants, expected } = readBody(req);
    const { auth, db } = adminServices();
    const base = { auth, db, token, eventId };
    if (action === 'export-start') return res.status(200).json(await startEventExport(base));
    if (action === 'export-page') return res.status(200).json(await exportEventPage({ ...base, path, cursor: cursor ?? null }));
    if (action === 'restore-begin') return res.status(200).json(await beginEventRestore(base));
    if (action === 'restore-write') return res.status(200).json(await writeEventRestorePage({ ...base, path, docs }));
    if (action === 'restore-finish') return res.status(200).json(await finishEventRestore({ ...base, event, cards, grants, expected }));
    throw new AdminError(400, 'INVALID_ACTION', 'Unknown backup action.');
  } catch (error) {
    return sendError(res, error, 'Event backup');
  }
}
