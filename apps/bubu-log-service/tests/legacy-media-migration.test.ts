import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MediaMigrationManifest, SidecarMediaReferences, rewriteMedia, type MigrationEntry } from '../scripts/lib/legacy-media';
import { recordsFixture, type RecordsFixture } from './fixtures/records';

const url = 'https://photos.example.test/old.png', uri = 'bubu-attachment:att_'+'a'.repeat(64);
const entry: MigrationEntry = { at: '2026-10-24T08:00:00.000Z', kind: 'activity', documentId: 'old', babyId: 'baby-a', url, sourceSha256: 'b'.repeat(64), normalizedSha256: 'c'.repeat(64), attachmentId: 'att_'+'a'.repeat(64) };
describe('private image migration recovery', () => {
  let directory: string, fixture: RecordsFixture;
  beforeAll(async () => { directory = await mkdtemp(path.join(tmpdir(),'bubu-manifest-')); fixture = await recordsFixture(); },30000);
  afterAll(async () => { await fixture?.close(); await rm(directory,{recursive:true,force:true}); });
  it('preserves different URLs sharing the same prefix in fields, raw text and serialized JSON', () => {
    const other = url+'?ver=2';
    const value = { poopPhotoUrl:other, before:{poopPhotoUrl:url}, text:`photo ${url}, next ${other}`, json:JSON.stringify({poopPhotoUrl:other,old:url}) };
    expect(rewriteMedia(value,url,uri)).toEqual({ poopPhotoUrl:other,before:{poopPhotoUrl:uri},text:`photo ${uri}, next ${other}`,json:JSON.stringify({poopPhotoUrl:other,old:uri}) });
  });
  it('durably validates receipts and refuses truncated or tampered manifests before replay', async () => {
    const file = path.join(directory,'valid');
    const journal = new MediaMigrationManifest(file); journal.append(entry); journal.close();
    expect((await stat(file)).mode & 0o077).toBe(0);
    const reopened = new MediaMigrationManifest(file); expect(reopened.entries).toEqual([entry]);
    expect(() => reopened.append({...entry,sourceSha256:'d'.repeat(64)})).toThrow('changed'); reopened.close();
    const original = await readFile(file,'utf8');
    await writeFile(path.join(directory,'half'),original.slice(0,-8),{mode:0o600});
    expect(() => new MediaMigrationManifest(path.join(directory,'half'))).toThrow('Incomplete');
    await writeFile(path.join(directory,'tampered'),original.replace('old.png','new.png'),{mode:0o600});
    expect(() => new MediaMigrationManifest(path.join(directory,'tampered'))).toThrow('integrity');
  });
  it('replays after core-only commit, preserves request fingerprints, and supports edit, retry, undo and restore', async () => {
    fixture.legacy.activities.set('old',{ id:'old',babyId:'baby-a',type:'DIAPER',startTime:'2026-10-23T08:00:00.000Z',hasPoop:true,hasPee:false,poopColor:'YELLOW',poopPhotoUrl:url });
    fixture.legacy.activities.set('other',{ id:'other',babyId:'baby-b',type:'DIAPER',startTime:'2026-10-23T08:00:00.000Z',poopPhotoUrl:url });
    const first = { babyId:'baby-a',requestId:'before-migration',eventId:'old',expectedVersion:1,patch:{facts:{notes:'first edit'}} };
    await fixture.records.update(fixture.alice, first);
    const operations = await fixture.store.payload.find({collection:'care-operations',pagination:false,limit:0});
    const fingerprints = operations.docs.map(row => (row.value as Record<string,unknown>).fingerprint);
    const migration = new SidecarMediaReferences(fixture.identity,async () => {});
    expect((await migration.inventory()).some(row => row.url === url)).toBe(true);
    // Crash point: core transaction committed, sidecar still contains old CAS/revision snapshots.
    fixture.legacy.activities.set('old',{...fixture.legacy.activities.get('old')!,poopPhotoUrl:uri});
    await migration.replace('baby-a',url,uri); await migration.replace('baby-a',url,uri);
    expect((await migration.inventory()).every(row => row.url === uri)).toBe(true);
    expect((await fixture.store.payload.find({collection:'care-operations',pagination:false,limit:0})).docs.map(row => (row.value as Record<string,unknown>).fingerprint)).toEqual(fingerprints);
    const retried = await fixture.records.update(fixture.alice,first);
    expect(retried.events[0]?.facts.poopPhotoUrl).toBe(uri);
    const second = await fixture.records.update(fixture.alice,{...first,requestId:'after-migration',expectedVersion:2,patch:{facts:{notes:'second edit'}}});
    const event = second.events[0]!;
    const revisions = await fixture.records.revisions(fixture.alice,'baby-a','old');
    const undone = await fixture.records.undo(fixture.alice,{babyId:'baby-a',requestId:'undo-migrated',eventId:'old',expectedVersion:event.version,revisionId:revisions.find(row => row.version === event.version)!.id});
    expect(undone.events[0]?.facts.poopPhotoUrl).toBe(uri);
    const retracted = await fixture.records.retract(fixture.alice,{babyId:'baby-a',requestId:'retract-migrated',eventId:'old',expectedVersion:undone.events[0]!.version});
    const restored = await fixture.records.retract(fixture.alice,{babyId:'baby-a',requestId:'restore-migrated',eventId:'old',expectedVersion:retracted.events[0]!.version},true);
    expect(restored.events[0]?.facts.poopPhotoUrl).toBe(uri);
    expect(fixture.legacy.activities.get('old')?.poopPhotoUrl).toBe(uri);
    expect(fixture.legacy.activities.get('other')?.poopPhotoUrl).toBe(url);
    await expect(new SidecarMediaReferences(fixture.identity,async () => {throw new Error('frozen');}).replace('baby-a',uri,url)).rejects.toThrow('frozen');
  });
});
