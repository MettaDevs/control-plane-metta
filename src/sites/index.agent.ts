import type { Config } from '../platform/config/index.ts';
import { enrollmentAgentRoutes } from './enrollment/enrollment.agent.routes.ts';
import { siteKeyAgentRoutes } from './enrollment/site-key.agent.routes.ts';
import { operationAgentRoutes } from './operation/operation.agent.routes.ts';
import { releaseFileAgentRoutes } from './release-file/release-file.agent.routes.ts';
import { registryCredentialAgentRoutes } from './registry-credential/registry-credential.agent.routes.ts';
import { reportAgentRoutes } from './report/report.agent.routes.ts';

// API agen situs untuk proses agen, sesuai contracts/agent/openapi.yaml.
export const siteAgentRoutes = (config: Config) => ({
    ...enrollmentAgentRoutes(),
    ...reportAgentRoutes(),
    ...siteKeyAgentRoutes(),
    ...operationAgentRoutes(config),
    ...releaseFileAgentRoutes(),
    ...registryCredentialAgentRoutes(config),
});
