// The region every Zestil edge-function call asks Supabase to run in: next to the database (us-west-1), not
// next to the caller. Supabase otherwise picks the region nearest the caller, and every query the function makes
// then crosses the world. Moving the database means changing this one constant.
export const EDGE_REGION = "us-west-1";

// The header Supabase reads to choose the region (the same thing supabase-js sends for FunctionRegion).
export const EDGE_REGION_HEADER = { "x-region": EDGE_REGION } as const;

// The same choice as a query parameter (supabase-js sends both). A call from the browser uses this one: the
// edge functions' CORS preflight does not list `x-region` in Access-Control-Allow-Headers, so the header makes
// the browser block the request. Server-side calls have no CORS and keep the header.
export const EDGE_REGION_QUERY = `forceFunctionRegion=${EDGE_REGION}`;
