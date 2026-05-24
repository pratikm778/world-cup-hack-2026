import fs from "fs";
import path from "path";

export function loadAgentInstructions(repoRoot: string): string {
  try {
    const raw = fs.readFileSync(path.join(repoRoot, "test.pipe"), "utf8");
    const cleaned = raw.replace(/,(\s*[\]}])/g, "$1");
    const pipe = JSON.parse(cleaned);
    const agent = pipe.components.find((c: any) => c.id === "agent_deepagent_1");
    const instructions: string[] = agent?.config?.default?.instructions || [];
    return instructions.join("\n\n");
  } catch {
    return (
      "You are EdgeCast — game-intelligence copilot. Surface ONE OPPORTUNITY when game " +
      "trends and market prices look misaligned. Use market names and cent prices. " +
      "Otherwise return an empty string. Do not suggest placing orders."
    );
  }
}

export type TopMover = {
  market_id: string;
  question: string;
  open_c: number;
  close_c: number;
  delta_c: number;
};

export async function callGmiTickBroadcast(
  instructions: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const apiKey = process.env.GMI_API_KEY || process.env.ROCKETRIDE_GMI_API_KEY;
  if (!apiKey) return "";

  const response = await fetch("https://api.gmi-serving.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.GMI_MODEL || "google/gemini-3.5-flash",
      messages: [
        { role: "system", content: instructions },
        { role: "user", content: JSON.stringify(payload, null, 2) },
      ],
      temperature: 0.2,
      max_tokens: 300,
    }),
  });

  if (!response.ok) return "";
  const result = await response.json();
  return (result?.choices?.[0]?.message?.content || "").trim();
}
