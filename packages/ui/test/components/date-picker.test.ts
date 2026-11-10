import { afterAll, test } from 'bun:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    DatePicker,
    dateValue,
    formatDateInput,
    parseDate,
    parseDateInput,
} from '../../src/components/date-picker.tsx';
import { DateTimePicker } from '../../src/components/date-time-picker.tsx';
import { Input } from '../../src/components/input.tsx';

// Test ini berganti zona waktu; berkas test lain berjalan di proses yang sama.
const originalZone = process.env.TZ;
afterAll(() => {
    if (originalZone === undefined) delete process.env.TZ;
    else process.env.TZ = originalZone;
});

test('DatePicker calendar dates, typed input, native form values, required and read-only', () => {
    for (const zone of ['Asia/Makassar', 'Pacific/Honolulu', 'Europe/Berlin']) {
        process.env.TZ = zone;

        for (const value of [
            '2026-10-19',
            '2024-02-29',
            '2026-03-29',
            '0001-01-01',
        ]) {
            const date = parseDate(value);
            assert.ok(date, `${zone}: ${value}`);
            assert.equal(
                dateValue(date),
                value,
                'Calendar dates must not shift through UTC conversion',
            );
        }
    }

    for (const invalid of [
        '2026-02-29',
        '2026-04-31',
        '0000-01-01',
        '2026-13-01',
        '2026-01-00',
        '19/10/2026',
        '2026-1-1',
    ]) {
        assert.equal(parseDate(invalid), undefined, invalid);
    }

    assert.equal(parseDateInput('19/10/2026'), '2026-10-19');
    assert.equal(parseDateInput('1/2/2026'), '2026-02-01');
    assert.equal(parseDateInput(' 2026-10-19 '), '2026-10-19');
    assert.equal(parseDateInput(''), '');
    assert.equal(parseDateInput('31/02/2026'), undefined);
    assert.equal(parseDateInput('19/10/'), undefined);
    let typed = '';

    for (const digit of '19102026') {
        typed = formatDateInput(typed + digit).text;
    }

    assert.equal(typed, '19/10/2026');
    assert.equal(formatDateInput('19102026').text, '19/10/2026');
    assert.equal(formatDateInput('2026-10-19').text, '19/10/2026');
    assert.equal(formatDateInput('19/10/2026').text, '19/10/2026');
    assert.deepEqual(formatDateInput('19', 2, 'deleteContentBackward'), {
        text: '19',
        caret: 2,
    });
    assert.deepEqual(formatDateInput('19/10', 5, 'deleteContentBackward'), {
        text: '19/10',
        caret: 5,
    });
    assert.deepEqual(formatDateInput('1/10/2026', 1, 'deleteContentBackward'), {
        text: '1/10/2026',
        caret: 1,
    });
    assert.equal(formatDateInput('31022026').text, '31/02/2026');
    assert.equal(parseDateInput(formatDateInput('31022026').text), undefined);
    assert.equal(
        parseDateInput(formatDateInput('29022024').text),
        '2024-02-29',
    );
    assert.equal(
        formatDateInput('191020260').text,
        '191020260',
        'Extra digits must remain invalid, never silently truncated',
    );

    const html = renderToStaticMarkup(
        React.createElement(DatePicker, {
            label: 'Tanggal terima',
            value: '2026-10-19',
            name: 'received_on',
            required: true,
        }),
    );
    assert.match(html, /type="text"/);
    assert.doesNotMatch(html, /type="date"/);
    assert.match(html, /value="19\/10\/2026"/);
    assert.match(html, /type="hidden" name="received_on" value="2026-10-19"/);
    assert.match(html, /required=""/);
    assert.match(html, /aria-label="Pilih tanggal: Tanggal terima"/);
    assert.match(html, /placeholder="dd\/mm\/yyyy"/);
    assert.match(html, /placeholder:text-transparent/);
    assert.match(html, /focus:placeholder:text-/);
    const regularInput = renderToStaticMarkup(
        React.createElement(Input, {
            label: 'Nama',
            placeholder: 'Nama perusahaan',
        }),
    );
    assert.match(
        regularInput,
        /placeholder=" "/,
        'Ordinary floating labels must keep their existing behavior',
    );
    const empty = renderToStaticMarkup(
        React.createElement(DatePicker, {
            name: 'received_on',
            defaultValue: '',
            required: true,
        }),
    );
    assert.match(empty, /type="hidden" name="received_on" value=""/);
    const readOnly = renderToStaticMarkup(
        React.createElement(DatePicker, {
            name: 'received_on',
            value: '2026-10-19',
            readOnly: true,
        }),
    );
    assert.match(readOnly, /readOnly=""/);
    assert.match(readOnly, /disabled=""/);
    const invalidDraft = renderToStaticMarkup(
        React.createElement(DatePicker, {
            name: 'received_on',
            value: '31/02/2026',
        }),
    );
    assert.match(
        invalidDraft,
        /value="31\/02\/2026"/,
        'Remounting a collapsed section must keep the invalid draft visible',
    );
    assert.match(
        invalidDraft,
        /type="hidden" name="received_on" value=""/,
        'Invalid drafts must not submit a previous valid date',
    );
    const localTime = renderToStaticMarkup(
        React.createElement(DateTimePicker, {
            label: 'Mulai',
            value: '2026-10-19T13:45',
            required: true,
            onValueChange: () => {},
        }),
    );
    assert.match(localTime, /value="19\/10\/2026"/);
    assert.match(localTime, /type="time"[^>]*value="13:45"/);
    assert.doesNotMatch(localTime, /datetime-local/);
});
