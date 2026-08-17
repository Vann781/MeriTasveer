import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../src/app.js';

let server;
let baseUrl;

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  // fetch() keeps sockets alive, so drop them or close() would hang.
  server.closeAllConnections();
  server.close();
});

describe('API basics', () => {
  it('GET /api/health returns ok', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: 'ok' });
  });

  it('unknown routes return a clean 404', async () => {
    const res = await fetch(`${baseUrl}/api/nope`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error.message, 'Not found');
  });

  it('requires a signed-in participant for event routes', async () => {
    const res = await fetch(`${baseUrl}/api/events/1/photos`);
    assert.equal(res.status, 401);
  });
});
