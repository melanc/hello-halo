/**
 * ServerConnectPage - Server connection flow page for Capacitor mobile app.
 *
 * Wraps the ServerConnect component as a full-screen page.
 * The actual connection logic lives in components/setup/ServerConnect.tsx,
 * which is reused both as this page and as a sub-flow in ServerListPage.
 */

export { ServerConnect as ServerConnectPage } from '../components/setup/ServerConnect'
export type { ServerAddedInfo } from '../components/setup/ServerConnect'
