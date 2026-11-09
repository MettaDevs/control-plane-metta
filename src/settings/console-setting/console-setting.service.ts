import { z } from 'zod';
import type { Database } from '../../platform/database/index.ts';
import type { SecretBox } from '../../platform/secret-box/index.ts';

// Setelan konsol yang berupa rahasia, misalnya robot sistem Harbor, disimpan terenkripsi dengan kunci turunan APP_KEY.
// Database yang bocor tanpa APP_KEY tidak membuka isinya.
export async function storeSecretSetting(
    db: Database,
    box: SecretBox,
    key: string,
    value: unknown,
    updatedBy: string | null,
): Promise<void> {
    await db.execute(
        `insert into console_settings (key, value, updated_at, updated_by)
         values ($1, $2, now() at time zone 'utc', $3)
         on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at,
            updated_by = excluded.updated_by`,
        [key, box.seal(JSON.stringify(value)), updatedBy],
    );
}

export async function readSecretSetting<S extends z.ZodType>(
    db: Database,
    box: SecretBox,
    key: string,
    schema: S,
): Promise<z.output<S> | null> {
    const row = await db.one(
        z.object({ value: z.string() }),
        'select value from console_settings where key = $1',
        [key],
    );
    if (!row) return null;
    return schema.parse(JSON.parse(box.open(row.value)));
}
