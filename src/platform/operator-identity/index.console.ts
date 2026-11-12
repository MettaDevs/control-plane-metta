import type { Config } from '../config/index.ts';
import { operatorInvitationRoutes } from './invitation/invitation.console.routes.ts';
import { loginRoutes } from './login/login.console.routes.ts';
import { type ConsoleSession, consoleSession } from './session.console.ts';
import { ssoRoutes } from './sso/sso.console.routes.ts';
import { twoFactorRoutes } from './two-factor/two-factor.console.routes.ts';

export { type ConsoleSession, consoleSession } from './session.console.ts';

// Semua route identitas operator untuk proses konsol. Area lain memakai sesi yang sama untuk route operatornya.
export function operatorIdentityRoutes(
    config: Config,
    session: ConsoleSession = consoleSession(config),
) {
    return {
        ...loginRoutes(config, session),
        ...twoFactorRoutes(config, session),
        ...ssoRoutes(config, session),
        ...operatorInvitationRoutes(config, session),
    };
}
