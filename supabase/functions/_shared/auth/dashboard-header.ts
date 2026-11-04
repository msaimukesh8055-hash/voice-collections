// supabase/functions/_shared/auth/dashboard-header.ts
// The header the dashboard page sends its link token in (M6). Its own file so the web app can
// import it without the server-side signing code.
export const DASHBOARD_TOKEN_HEADER = 'x-dashboard-token';
