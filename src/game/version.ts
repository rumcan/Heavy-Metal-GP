/**
 * The game's version, shown in the What's new pop-up. Keep it equal to the RUN.world version this build is deployed
 * as (`rundot game list-versions`; `rundot deploy` bumps the minor number by default).
 */
export const APP_VERSION = '1.16.0';

/** Storage key holding the last version whose What's new the player has seen. */
export const SEEN_VERSION_KEY = 'heavy-metal-gp:whats-new-seen';
