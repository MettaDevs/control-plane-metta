import { describe, expect, test } from 'bun:test';
import { environmentAddress } from '../../src/environments/index.ts';

describe('alamat lingkungan', () => {
    test('produksi di <tenant>.<host>, demo dan sandbox di <tenant>.<jenis>.<host>, dengan skema dan port', () => {
        const base = 'https://operations.example.com';
        expect(environmentAddress(base, 'klinik', 'production')).toBe(
            'https://klinik.operations.example.com',
        );
        expect(environmentAddress(base, 'klinik', 'demo')).toBe(
            'https://klinik.demo.operations.example.com',
        );
        expect(
            environmentAddress('http://localhost:8102', 'klinik', 'sandbox'),
        ).toBe('http://klinik.sandbox.localhost:8102');
        expect(
            environmentAddress(undefined, 'klinik', 'production'),
        ).toBeNull();
    });
});
