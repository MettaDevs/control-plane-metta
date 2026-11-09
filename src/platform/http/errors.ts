export class HttpFailure extends Error {
    constructor(
        readonly status: number,
        readonly body: object,
        readonly headers: Record<string, string> = {},
    ) {
        super(`HTTP ${status}`);
    }
}

export function abort(status: number, message: string): never {
    throw new HttpFailure(status, { message });
}
