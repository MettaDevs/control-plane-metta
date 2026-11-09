import { reportIntervalSeconds } from '../enrollment/enrollment.agent.routes.ts';
import { fromAgentId } from '../agent-id.ts';
import {
    agentError,
    parseJson,
    signedProcedure,
} from '../signature/agent-request.agent.ts';
import { reportSchema } from './report.schema.ts';
import { recordReport } from './report.service.ts';

export const reportAgentRoutes = () => ({
    reportSiteState: signedProcedure
        .route({ method: 'POST', path: '/api/agent/v1/report' })
        .handler(async ({ context }) => {
            const report = reportSchema.safeParse(parseJson(context.body));
            // site_id di isi laporan wajib situs penanda tangan, supaya satu situs tidak bisa melapor atas nama situs lain.
            if (
                !report.success ||
                fromAgentId(report.data.site_id) !== context.site.id
            )
                throw agentError(422, 'report_invalid');
            await recordReport(
                context.db,
                context.site.id,
                report.data,
                context.clientAddress,
            );
            return { interval_seconds: reportIntervalSeconds };
        }),
});
