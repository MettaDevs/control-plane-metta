import { z } from 'zod';
import type { Config } from '../../platform/config/index.ts';
import { base, HttpFailure } from '../../platform/http/index.ts';
import { parseSignature } from '../../sites/index.ts';
import {
    claimOperation,
    recordStep,
    stepSchema,
} from './environment-operation.service.ts';

const workerError = (status: number, error: string) =>
    new HttpFailure(status, { error });

// Host runtime ditentukan dari tanda tangan yang sudah diperiksa (keyid = id host), tidak pernah dari isi request.
// Bentuk tanda tangannya sama dengan API agen: RFC 9421, rsa-v1_5-sha256, atas @method, @path, dan content-digest.
const signedWorker = base.use(async ({ context, next }) => {
    const path = new URL(context.request.url).pathname;
    const body = await context.rawBody();
    const headers = context.request.headers;
    const signature = parseSignature(
        {
            method: context.request.method,
            path,
            contentDigest: headers.get('content-digest'),
            signatureInput: headers.get('signature-input'),
            signature: headers.get('signature'),
        },
        body,
        Math.floor(Date.now() / 1000),
    );
    const hostId = z.uuid().safeParse(signature?.keyId);
    const host = hostId.success
        ? await context.db.one(
              z.object({ id: z.string(), public_key: z.string() }),
              'select id, public_key from runtime_hosts where id = $1 and revoked_at is null',
              [hostId.data],
          )
        : undefined;
    if (!signature || !host || !signature.verify(host.public_key))
        throw workerError(401, 'signature_invalid');
    let json: unknown;
    try {
        json = body.length ? JSON.parse(new TextDecoder().decode(body)) : {};
    } catch {
        throw workerError(400, 'body_invalid');
    }
    return next({ context: { host, json } });
});

export function environmentOperationAgentRoutes(config: Config) {
    return {
        claimEnvironmentOperation: signedWorker
            .route({
                method: 'POST',
                path: '/api/worker/v1/operations/claim',
                outputStructure: 'detailed',
            })
            .handler(async ({ context }) => {
                const operation = await claimOperation(
                    context.db,
                    context.host.id,
                );
                return operation
                    ? {
                          status: 200,
                          headers: { 'Cache-Control': 'no-store' },
                          body: { operation },
                      }
                    : { status: 204, headers: {}, body: undefined };
            }),
        recordEnvironmentStep: signedWorker
            .route({
                method: 'POST',
                path: '/api/worker/v1/operations/{operation}/steps',
                inputStructure: 'detailed',
            })
            .input(z.object({ params: z.object({ operation: z.uuid() }) }))
            .handler(async ({ context, input }) => {
                const step = stepSchema.safeParse(context.json);
                if (!step.success) throw workerError(422, 'step_invalid');
                const result = await recordStep(
                    context.db,
                    context.host.id,
                    input.params.operation,
                    step.data,
                    config.ENVIRONMENT_PURGE_GRACE_DAYS,
                );
                if (!result) throw workerError(409, 'operation_not_held');
                return result;
            }),
    };
}
