import { describe, expect, test } from 'bun:test';
import { fromAgentId, toAgentId } from '../../src/sites/agent-id.ts';

// Pasangan yang sama dihasilkan parity/ids.py operations-metta, yang memakai rumus 0002_ids_to_uuid.sql.
const pairs = [
    ['01ARZ3NDEKTSV4RRFFQ69G5FAV', '01563e3a-b5d3-d676-4c61-efb99302bd5b'],
    ['01JQST0000E008000000000001', '0195f3a0-0000-7000-8000-000000000001'],
    ['7ZZZZZZZZZZZZZZZZZZZZZZZZZ', 'ffffffff-ffff-ffff-ffff-ffffffffffff'],
] as const;

describe('agent id', () => {
    test.each(pairs)('%s is %s', (ulid, uuid) => {
        expect(toAgentId(uuid)).toBe(ulid);
        expect(fromAgentId(ulid)).toBe(uuid);
        expect(fromAgentId(ulid.toLowerCase())).toBe(uuid);
        expect(fromAgentId(uuid.toUpperCase())).toBe(uuid);
    });

    test('round-trips new ids', () => {
        const uuid = Bun.randomUUIDv7();
        expect(fromAgentId(toAgentId(uuid))).toBe(uuid);
    });

    test('rejects what is neither', () => {
        for (const value of [
            '',
            '8ZZZZZZZZZZZZZZZZZZZZZZZZZ',
            '01ARZ3NDEKTSV4RRFFQ69G5FAU!',
            '01ARZ3NDEKTSV4RRFFQ69G5FAI',
            'not-a-uuid',
        ])
            expect(fromAgentId(value)).toBeNull();
    });
});
