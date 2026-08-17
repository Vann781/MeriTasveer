import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GoogleDriveService, isValidDriveId } from '../src/services/googleDrive.js';

describe('GoogleDriveService (no credentials required)', () => {
  it('accepts real-looking Drive IDs and rejects junk', () => {
    assert.equal(isValidDriveId('1A2b3C4d5E6f7G8h9I0jK'), true);
    assert.equal(isValidDriveId('../etc/passwd'), false);
    assert.equal(isValidDriveId("' or '1'='1"), false);
    assert.equal(isValidDriveId(''), false);
    assert.equal(isValidDriveId(undefined), false);
  });

  // Empty strings rather than null/undefined, so a developer's real .env
  // cannot leak in through the constructor defaults.
  it('explains what is missing instead of throwing a raw Google error', () => {
    const noRoot = new GoogleDriveService({ rootFolderId: '', keyFile: '' });
    assert.throws(() => noRoot.assertConfigured(), /GOOGLE_DRIVE_ROOT_FOLDER_ID/);

    const noKey = new GoogleDriveService({ rootFolderId: '1A2b3C4d5E6f7G8h9I0jK', keyFile: '' });
    assert.throws(() => noKey.assertConfigured(), /GOOGLE_SERVICE_ACCOUNT_KEY_FILE/);

    const badRoot = new GoogleDriveService({ rootFolderId: 'not a real id', keyFile: '' });
    assert.throws(() => badRoot.assertConfigured(), /does not look like a Drive folder ID/);
  });

  it('refuses to list photos for an invalid event ID', async () => {
    const service = new GoogleDriveService({ rootFolderId: '1A2b3C4d5E6f7G8h9I0jK' });
    await assert.rejects(() => service.listPhotos('nope'), /Invalid event ID/);
  });
});
