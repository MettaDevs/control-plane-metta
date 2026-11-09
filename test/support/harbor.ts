// Harbor tiruan untuk test: server HTTP sungguhan dengan API robot dan project yang dipakai control plane, termasuk
// perilaku Harbor yang menjawab kredensial salah dengan 200 [] untuk project privat.
type Robot = {
    id: number;
    name: string;
    secret: string;
    project: string;
    action: string;
};

export class HarborStub {
    readonly project = 'coreerp';
    readonly systemRobot = { name: 'robot$console', secret: 'system-secret' };
    readonly robots = new Map<number, Robot>();
    failCreate = false;
    private nextId = 100;
    private server!: ReturnType<typeof Bun.serve>;

    static start(): HarborStub {
        const stub = new HarborStub();
        stub.server = Bun.serve({
            port: 0,
            hostname: '127.0.0.1',
            fetch: (request) => stub.handle(request),
        });
        return stub;
    }

    get url(): string {
        return `http://127.0.0.1:${this.server.port}`;
    }

    stop(): void {
        this.server.stop(true);
    }

    private authorized(request: Request): boolean {
        const expected = `Basic ${Buffer.from(`${this.systemRobot.name}:${this.systemRobot.secret}`).toString('base64')}`;
        return request.headers.get('authorization') === expected;
    }

    private async handle(request: Request): Promise<Response> {
        const url = new URL(request.url);
        if (request.method === 'GET' && url.pathname === '/api/v2.0/projects')
            return Response.json(
                this.authorized(request) &&
                    url.searchParams.get('name') === this.project
                    ? [{ name: this.project }]
                    : [],
            );
        if (!this.authorized(request))
            return Response.json({ errors: [] }, { status: 401 });
        if (request.method === 'POST' && url.pathname === '/api/v2.0/robots') {
            if (this.failCreate)
                return Response.json({ errors: [] }, { status: 500 });
            const body = (await request.json()) as {
                name: string;
                duration: number;
                permissions: {
                    namespace: string;
                    access: { action: string }[];
                }[];
            };
            const id = this.nextId++;
            const robot = {
                id,
                name: `robot$${this.project}+${body.name}`,
                secret: `secret-${id}`,
                project: body.permissions[0]?.namespace ?? '',
                action: body.permissions[0]?.access[0]?.action ?? '',
            };
            this.robots.set(id, robot);
            return Response.json(
                {
                    id,
                    name: robot.name,
                    secret: robot.secret,
                    expires_at:
                        Math.floor(Date.now() / 1000) + body.duration * 86400,
                },
                { status: 201 },
            );
        }
        const deleted = /^\/api\/v2\.0\/robots\/(\d+)$/.exec(url.pathname);
        if (request.method === 'DELETE' && deleted?.[1]) {
            const existed = this.robots.delete(Number(deleted[1]));
            return new Response(null, { status: existed ? 200 : 404 });
        }
        return new Response('Not Found', { status: 404 });
    }
}
