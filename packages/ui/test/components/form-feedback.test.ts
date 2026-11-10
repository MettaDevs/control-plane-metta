import { test } from 'bun:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    collectFormFeedback,
    createSaveFeedback,
    FormErrorSummary,
    getFormValidationErrors,
    validateFormSubmission,
} from '../../src/components/form-feedback.tsx';
import { RecordActionBar } from '../../src/components/record-action-bar.tsx';

// Kontrol tiruan hanya membawa bagian yang dibaca getFormValidationErrors, jadi bentuknya dipaksakan ke tipe DOM.
const scope = (controls: unknown[]) =>
    ({ querySelectorAll: () => controls }) as unknown as HTMLElement;

test('form feedback behavior', () => {
    const failure = createSaveFeedback({
        operation: 'Dokumen belum disimpan.',
        message: 'Validation failed',
        status: 422,
        errors: {
            name: ['Isi nama.', 'Nama terlalu panjang.'],
            'lines.1.quantity': 'Isi jumlah minimal 1.',
        },
    });
    assert.equal(failure.issues!.length, 3);
    assert.match(failure.title, /2 isian/);
    assert.deepEqual(
        failure.issues!.map((issue) => issue.field),
        ['name', 'name', 'lines.1.quantity'],
    );
    const summary = React.createElement(FormErrorSummary, {
        feedback: failure,
    });
    const rendered = renderToStaticMarkup(summary);
    assert.match(rendered, /role="alert"/);
    assert.match(rendered, /Isi nama\./);
    assert.match(rendered, /Nama terlalu panjang\./);
    assert.match(rendered, /Isi jumlah minimal 1\./);
    assert.doesNotMatch(rendered, /role="dialog"/);
    assert.doesNotMatch(
        rendered,
        /underline-offset-4/,
        'unscoped issues do not promise field navigation',
    );
    assert.equal(
        renderToStaticMarkup(
            React.createElement(FormErrorSummary, { feedback: null }),
        ),
        '',
    );
    assert.match(rendered, /aria-label="Ringkas pesan"/);
    assert.match(rendered, /aria-label="Sembunyikan pesan"/);
    assert.match(rendered, /aria-expanded="true"/);
    const second = createSaveFeedback({
        operation: 'Lampiran belum diunggah',
        message: 'Berkas melebihi batas ukuran.',
    });
    assert.deepEqual(
        collectFormFeedback([failure, null, second, { ...failure }]),
        [failure, second],
    );
    const stacked = renderToStaticMarkup(
        React.createElement(FormErrorSummary, { feedback: [failure, second] }),
    );
    assert.equal(
        (stacked.match(/data-slot="form-error-notice"/g) ?? []).length,
        2,
    );
    assert.equal(
        (stacked.match(/aria-label="Sembunyikan pesan"/g) ?? []).length,
        2,
    );
    assert.match(stacked, /Berkas melebihi batas ukuran/);
    assert.match(stacked, /Isi jumlah minimal 1/);
    assert.equal(
        renderToStaticMarkup(
            React.createElement(FormErrorSummary, { feedback: [null] }),
        ),
        '',
    );
    const internal = createSaveFeedback({
        operation: 'Dokumen belum disimpan.',
        message: 'SQLSTATE secret',
        status: 500,
        errors: { name: 'SQL sensitive' },
        details: 'Nomor referensi aman',
    });
    assert.equal(internal.title, 'Dokumen belum disimpan');
    assert.equal(internal.issues, undefined);
    assert.doesNotMatch(JSON.stringify(internal), /SQL/);
    const defaultDetails = createSaveFeedback({
        operation: 'Simpan dokumen',
        message: 'SQLSTATE secret',
        status: 500,
        code: 'internal_error',
    });
    assert.match(defaultDetails.details!, /Status HTTP: 500/);
    assert.doesNotMatch(defaultDetails.details!, /SQLSTATE/);
    const copy = renderToStaticMarkup(
        React.createElement(FormErrorSummary, { feedback: internal }),
    );
    assert.match(copy, /Salin detail bantuan/);
    assert.doesNotMatch(copy, /Nomor referensi aman/);
    assert.doesNotMatch(copy, /role="dialog"/);
    const stale = createSaveFeedback({
        operation: 'Simpan belum berhasil',
        message: 'stale',
        status: 409,
        code: 'stale_version',
    });
    assert.match(stale.message, /Tinjau data terbaru/);
    assert.equal(
        stale.actions,
        undefined,
        'does not invent a reload action that discards drafts',
    );
    const denied = createSaveFeedback({
        operation: 'Simpan',
        message: 'Unauthorized raw',
        status: 403,
    });
    assert.match(denied.message, /pengelola akun/);
    assert.equal(
        denied.actions,
        undefined,
        'does not grant access or invent a destination',
    );

    for (const status of [401, 419]) {
        assert.match(
            createSaveFeedback({ operation: 'Simpan', message: '', status })
                .title,
            /Sesi login/,
        );
    }

    const action = () => {};
    assert.match(
        createSaveFeedback({
            operation: 'Upload',
            message: 'Request Entity Too Large',
            status: 413,
        }).title,
        /batas upload/,
    );
    assert.match(
        createSaveFeedback({
            operation: 'Upload',
            message: 'Unsupported media type',
            status: 415,
        }).title,
        /Format berkas/,
    );
    assert.equal(
        createSaveFeedback({
            operation: 'Simpan',
            message: 'Pilih akun.',
            actions: [{ label: 'Lihat pengaturan', onClick: action }],
        }).actions![0]!.onClick,
        action,
    );
    const bar = renderToStaticMarkup(
        React.createElement(
            RecordActionBar,
            { feedback: summary },
            React.createElement('button', {}, 'Simpan'),
        ),
    );
    assert.ok(
        bar.indexOf('Simpan') < bar.indexOf('data-slot="form-error-summary"'),
    );
    assert.match(bar, /role="alert"/);
    const input = (
        name: string,
        validity: Partial<ValidityState>,
        attributes: Record<string, string> = {},
    ) => ({
        name,
        id: name,
        willValidate: true,
        validity: { valid: false, ...validity },
        labels: [{ textContent: name === 'quantity' ? 'Jumlah *' : 'Tanggal' }],
        getAttribute: (key: string) => attributes[key] ?? null,
        validationMessage: 'Masukkan tanggal yang valid (dd/mm/yyyy).',
        reportValidity: () => {
            throw new Error('SDK must not open browser validation UI');
        },
    });
    const clientErrors = getFormValidationErrors(
        scope([
            input('quantity', { rangeUnderflow: true }, { min: '1' }),
            input('posting_date', { customError: true }),
            {
                ...input('ignored', { valueMissing: true }),
                willValidate: false,
            },
            input('valid', { valid: true }),
        ]),
    );
    assert.deepEqual(clientErrors, {
        quantity: ['Jumlah: isi nilai minimal 1.'],
        posting_date: ['Masukkan tanggal yang valid (dd/mm/yyyy).'],
    });
    let prevented = 0;
    let stopped = 0;
    const submitEvent = {
        preventDefault: () => prevented++,
        stopImmediatePropagation: () => stopped++,
    };
    assert.deepEqual(
        validateFormSubmission(
            scope([input('quantity', { valueMissing: true })]),
            submitEvent,
        ),
        { quantity: ['Isi jumlah sebelum melanjutkan.'] },
    );
    assert.equal(prevented, 1);
    assert.equal(stopped, 1);
    assert.deepEqual(
        validateFormSubmission(
            scope([input('quantity', { valid: true })]),
            submitEvent,
        ),
        {},
    );
    assert.equal(prevented, 1);
    assert.equal(stopped, 1);
});
