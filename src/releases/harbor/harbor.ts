import { z } from 'zod';

// Klien API Harbor dengan kredensial robot sistem. Tiga hal yang diminta dari Harbor, sama dengan konsol CoreERP:
// membuat robot pull-only untuk satu operasi, menghapusnya, dan memastikan robot sistem masih sah. Setiap kegagalan
// menjadi RegistryUnavailable, dan pesannya tidak pernah memuat rahasia.
export class RegistryUnavailable extends Error {}

export type HarborSettings = {
    apiUrl: string;
    project: string;
    robot: { name: string; secret: string };
};

export type PullRobot = {
    id: number;
    name: string;
    secret: string;
    expiresAt: Date;
};

const createdSchema = z.object({
    id: z.int(),
    name: z.string().min(1),
    secret: z.string().min(1),
    expires_at: z.int(),
});

export class HarborClient {
    constructor(private readonly settings: HarborSettings) {}

    private async send(
        path: string,
        init: RequestInit = {},
    ): Promise<Response> {
        const credentials = Buffer.from(
            `${this.settings.robot.name}:${this.settings.robot.secret}`,
        ).toString('base64');
        try {
            return await fetch(
                `${this.settings.apiUrl.replace(/\/$/, '')}/api/v2.0${path}`,
                {
                    ...init,
                    headers: {
                        accept: 'application/json',
                        authorization: `Basic ${credentials}`,
                        ...(init.body
                            ? { 'content-type': 'application/json' }
                            : {}),
                    },
                    signal: AbortSignal.timeout(15_000),
                },
            );
        } catch {
            throw new RegistryUnavailable(
                'Harbor tidak dapat dihubungi dari control plane ini.',
            );
        }
    }

    async createPullRobot(
        name: string,
        days: number,
        description: string,
    ): Promise<PullRobot> {
        const response = await this.send('/robots', {
            method: 'POST',
            body: JSON.stringify({
                name,
                level: 'project',
                duration: days,
                disable: false,
                description,
                permissions: [
                    {
                        kind: 'project',
                        namespace: this.settings.project,
                        access: [{ resource: 'repository', action: 'pull' }],
                    },
                ],
            }),
        });
        if (response.status !== 201)
            throw new RegistryUnavailable(
                `Harbor menolak pembuatan robot (HTTP ${response.status}).`,
            );
        const created = createdSchema.safeParse(
            await response.json().catch(() => null),
        );
        if (!created.success)
            throw new RegistryUnavailable(
                'Jawaban pembuatan robot dari Harbor tidak dikenal.',
            );
        return {
            id: created.data.id,
            name: created.data.name,
            secret: created.data.secret,
            expiresAt: new Date(created.data.expires_at * 1000),
        };
    }

    // Robot yang sudah tidak ada dianggap terhapus, supaya robot yang dihapus tangan atau kedaluwarsa tidak membuat
    // sapuan macet.
    async deleteRobot(id: number): Promise<void> {
        const response = await this.send(`/robots/${id}`, { method: 'DELETE' });
        if (response.status !== 200 && response.status !== 404)
            throw new RegistryUnavailable(
                `Harbor menolak penghapusan robot ${id} (HTTP ${response.status}).`,
            );
    }

    // Status HTTP saja tidak cukup: Harbor menjawab kredensial yang salah dengan 200 [] karena permintaannya dianggap
    // anonim. Yang membuktikan kredensialnya diterima adalah project privat itu muncul di jawabannya.
    async verifyRobot(): Promise<void> {
        const project = this.settings.project;
        const response = await this.send(
            `/projects?name=${encodeURIComponent(project)}`,
        );
        if (response.status === 401 || response.status === 403)
            throw new RegistryUnavailable(
                'Harbor menolak kredensial robot sistem.',
            );
        const projects = z
            .array(z.object({ name: z.string() }))
            .safeParse(response.ok ? await response.json() : null);
        if (!projects.success)
            throw new RegistryUnavailable(
                `Harbor menjawab HTTP ${response.status} saat project dibaca.`,
            );
        if (!projects.data.some((entry) => entry.name === project))
            throw new RegistryUnavailable(
                `Harbor tidak menunjukkan project ${project} kepada robot sistem: rahasianya salah, robotnya sudah dihapus, atau izinnya tidak mencakup project itu.`,
            );
    }
}
