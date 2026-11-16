// Minimal persistence: an in-memory map flushed to a JSON file after each write.
// Swap for Postgres in Phase 2; the service layer only uses get/put/all.

import fs from 'node:fs';
import path from 'node:path';

export function createStore(file) {
  let data = { requests: {} };
  if (file && fs.existsSync(file)) {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  }

  function flush() {
    if (!file) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file); // atomic replace so a crash never leaves a half-written file
  }

  return {
    get: (id) => data.requests[id] ?? null,
    put(request) {
      data.requests[request.id] = request;
      flush();
      return request;
    },
    all: () => Object.values(data.requests).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };
}
