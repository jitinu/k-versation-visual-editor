import { json } from "@/lib/api";
import { describeProviders } from "@/lib/config";

export const runtime = "nodejs";

/** Non-secret summary of which providers are active (for UI badges). */
export async function GET() {
  return json(describeProviders());
}
