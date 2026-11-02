// supabase/functions/_shared/region.ts
// Supabase runs a function in the edge region nearest the caller (Mumbai from India) unless this
// header names one. Callers pin it to the database's region (ADR-0008) so each query stays local.
export const REGION_HEADER = 'x-region';
