// Dibuat `bun scripts/generate-client.ts` dari setiap berkas `.portal.page.tsx`; jangan disunting tangan.
// `bun run build` dan `bun run dev` menulis ulang berkas ini, dan CI menolak berkas yang tidak mutakhir.
import { createRoute, createRouter } from '@tanstack/react-router';
import { page as customersPortalAccessInvitationPage } from './customers/portal-access/invitation.portal.page.tsx';
import { page as customersPortalEnvironmentsEnvironmentsPage } from './customers/portal-environments/environments.portal.page.tsx';
import { page as platformShellLoginPage } from './platform/shell/login.portal.page.tsx';
import {
    appLayoutRoute,
    authLayoutRoute,
    rootRoute,
    routerOptions,
    startClient,
} from './platform/shell/index.portal.ts';

const customersPortalAccessInvitationRoute = createRoute({
    getParentRoute: () => authLayoutRoute,
    path: customersPortalAccessInvitationPage.path,
    component: customersPortalAccessInvitationPage.component,
    validateSearch: customersPortalAccessInvitationPage.validateSearch,
    staticData: { title: customersPortalAccessInvitationPage.title },
});

const customersPortalEnvironmentsEnvironmentsRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: customersPortalEnvironmentsEnvironmentsPage.path,
    component: customersPortalEnvironmentsEnvironmentsPage.component,
    staticData: { title: customersPortalEnvironmentsEnvironmentsPage.title },
});

const platformShellLoginRoute = createRoute({
    getParentRoute: () => authLayoutRoute,
    path: platformShellLoginPage.path,
    component: platformShellLoginPage.component,
    validateSearch: platformShellLoginPage.validateSearch,
    staticData: { title: platformShellLoginPage.title },
});

const routeTree = rootRoute.addChildren([
    appLayoutRoute.addChildren([customersPortalEnvironmentsEnvironmentsRoute]),
    authLayoutRoute.addChildren([
        customersPortalAccessInvitationRoute,
        platformShellLoginRoute,
    ]),
]);

const router = createRouter({ ...routerOptions, routeTree });

declare module '@tanstack/react-router' {
    interface Register {
        router: typeof router;
    }
}

startClient(router);
