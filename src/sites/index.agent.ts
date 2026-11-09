import { enrollmentAgentRoutes } from './enrollment/enrollment.agent.routes.ts';
import { siteKeyAgentRoutes } from './enrollment/site-key.agent.routes.ts';
import { reportAgentRoutes } from './report/report.agent.routes.ts';

// API agen situs untuk proses agen, sesuai contracts/agent/openapi.yaml.
export const siteAgentRoutes = () => ({
    ...enrollmentAgentRoutes(),
    ...reportAgentRoutes(),
    ...siteKeyAgentRoutes(),
});
