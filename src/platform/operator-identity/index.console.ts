import type { Config } from '../config/index.ts';
import { loginRoutes } from './login/login.console.routes.ts';
import { consoleSession } from './session.console.ts';
import { ssoRoutes } from './sso/sso.console.routes.ts';
import { twoFactorRoutes } from './two-factor/two-factor.console.routes.ts';

// Semua route identitas operator untuk proses konsol, berbagi satu sesi konsol.
export function operatorIdentityRoutes(config: Config) {
    const session = consoleSession(config);
    return {
        ...loginRoutes(config, session),
        ...twoFactorRoutes(config, session),
        ...ssoRoutes(config, session),
    };
}
