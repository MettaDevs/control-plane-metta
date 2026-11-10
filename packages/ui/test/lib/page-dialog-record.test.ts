import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { createPageDialogRecordStore } from '../../src/lib/page-dialog-record.ts';

type RecordHeader = {
    recordTitle?: string;
    onEdit?: () => void;
    onDelete?: () => void;
    editing?: boolean;
};

test('record header registry: identity, callbacks, edit handoff, cleanup and card isolation', () => {
    const store = createPageDialogRecordStore<RecordHeader>();
    const card = Symbol('card');
    const form = Symbol('form');
    let notifications = 0;
    const unsubscribe = store.subscribe(() => notifications++);
    const edit = () => {};
    store.set(card, { recordTitle: '001 · Nama', onEdit: edit });
    assert.equal(store.getRecord()!.recordTitle, '001 · Nama');
    assert.equal(store.getRecord()!.onEdit, edit);
    store.set(card, { recordTitle: '001 · Nama', onEdit: edit });
    assert.equal(
        notifications,
        1,
        'unchanged metadata must not publish another render',
    );
    store.set(form, { recordTitle: '001 · Nama baru', editing: true });
    store.set(card, undefined);
    assert.equal(
        store.getRecord()!.editing,
        true,
        'parent cleanup must preserve the editing child',
    );
    const revision = store.getRevision();
    store.set(card, undefined);
    assert.equal(store.getRevision(), revision, 'repeated cleanup is harmless');
    store.set(form, { recordTitle: '001 · Nama terbaru', editing: true });
    assert.equal(store.getRecord()!.recordTitle, '001 · Nama terbaru');
    store.set(form, undefined);
    assert.equal(
        store.getRecord(),
        undefined,
        'closed cards must not leak their commands',
    );
    const other = createPageDialogRecordStore<RecordHeader>();
    other.set(Symbol('another-card'), { recordTitle: '002 · Lain' });
    assert.equal(store.getRecord(), undefined);
    const overrides = createPageDialogRecordStore<RecordHeader>();
    const overrideId = Symbol('optional-actions');
    overrides.set(overrideId, { onEdit: undefined });
    overrides.set(overrideId, { onDelete: undefined });
    assert.deepEqual(
        Object.keys(overrides.getRecord()!),
        ['onDelete'],
        'an absent action and an explicit undefined override are different',
    );
    unsubscribe();
    const before = notifications;
    store.set(card, { recordTitle: '003' });
    assert.equal(notifications, before);
});
