import { test } from 'bun:test';
import assert from 'node:assert/strict';
import {
    assertListBatch,
    mergeListSelection,
    visibleListOptions,
} from '../../src/components/use-incremental-list.ts';

test('incremental list: server order, empty search, immutable cache, and unloaded selection', () => {
    const items = Object.freeze([
        { value: 'all' },
        { value: 'old' },
        { value: 'later' },
        { value: 'first' },
    ]);
    assert.deepEqual(
        visibleListOptions(
            items as { value: string }[],
            ['first', 'later'],
            ['old', 'later', 'first'],
        ).map((item) => item.value),
        ['all', 'first', 'later'],
    );
    assert.deepEqual(
        visibleListOptions(
            items as { value: string }[],
            [],
            ['old', 'later', 'first'],
        ).map((item) => item.value),
        ['all'],
    );
    assert.equal(items[1]!.value, 'old');
    assert.deepEqual(
        mergeListSelection(['a', 'unloaded'], ['a', 'b'], ['a', 'b']),
        ['a', 'b', 'unloaded'],
    );
    assert.deepEqual(mergeListSelection(['a', 'unloaded'], ['a', 'b'], ['b']), [
        'b',
        'unloaded',
    ]);
    assert.deepEqual(
        mergeListSelection(['a', 'unloaded'], ['a', 'b', 'unloaded'], ['b']),
        ['b'],
    );
    assert.deepEqual(
        mergeListSelection(['unloaded', 'unloaded'], [], ['b', 'b']),
        ['b', 'unloaded'],
    );
    assert.doesNotThrow(() => assertListBatch({ items: [], nextCursor: null }));
    assert.throws(() => assertListBatch({ items: [] }));
    assert.throws(() => assertListBatch({ items: [], nextCursor: '' }));
    assert.throws(() => assertListBatch({ items: {}, nextCursor: null }));
});
