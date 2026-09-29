export const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';

export type Property = { id: string; name: string; city: string; base_price: number; current_occupancy_rate: number; target_occupancy_rate: number };
export type WorkflowStatus = 'pending' | 'running' | 'accepted' | 'rejected' | 'failed';
export type WorkflowResult = { property_id: string; pricing_date: string; workflow_id: string; status: WorkflowStatus; issue_codes: string[]; recommendation: { deterministic: { recommended_price: number; minimum_recommended_price: number; maximum_recommended_price: number }; ai_metadata: { explanation: string; confidence_score: number; risk_level: string } } | null; metrics: { estimated_cost_usd: number | null; latency_ms: number } | null };
export type Recommendation = { id: string; property_id: string; property_name: string; city: string; pricing_date: string; base_price: number; recommended_price: number; minimum_price: number; maximum_price: number; explanation: string; confidence_score: number; risk_level: string; validation_status: string; estimated_cost_usd: number | null; latency_ms: number | null; created_at: string };
export type DashboardSummary = { total_workflow_requests: number; accepted_recommendations: number; failed_workflows: number; validation_rejections: number; validation_pass_rate: number | null; average_ai_latency_ms: number | null; estimated_ai_cost_usd: number | null; recent_failed_workflows: { property_id: string; property_name: string | null; pricing_date: string; status: 'failed'; failure_code: string | null; failed_at: string | null }[] };

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
  if (!response.ok) throw new Error('The service is unavailable. Please try again.');
  return response.json() as Promise<T>;
}

export const usd = (value: number | null) => value === null ? 'Not available' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
export const percent = (value: number) => `${Math.round(value * 100)}%`;
export const today = () => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
};
