/** Base URL used by server-side requests to this application. */
export const APP_URL =
  process.env.APP_URL ?? `http://localhost:${process.env.PORT ?? '3000'}`;
