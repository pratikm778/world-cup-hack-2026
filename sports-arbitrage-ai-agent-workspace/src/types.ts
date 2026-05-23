export interface CommentaryLine {
  timeOffset: string; // e.g., "12'" or "85'"
  text: string;
  intensity: "neutral" | "high" | "critical"; // High means danger, critical means goal/breakaway
  audioTranscription?: string; // Supporting the dual text/audio announcer scream
  teamFocus?: "A" | "B" | "neutral";
}

export interface MatchScenario {
  id: string;
  sport: string;
  teamA: string;
  teamAImage: string;
  teamB: string;
  teamBImage: string;
  venue: string;
  description: string;
  polymarketOddsTimeline: Array<{
    yesA: number; // yes contract price for Team A win (0 to 1)
    yesB: number;
    draw: number;
    over25?: number; // YES price for "Over 2.5 Goals" contract (0 to 1)
    nextScorerA?: number; // YES price for Team A to score next (0 to 1)
    nextScorerB?: number; // YES price for Team B to score next (0 to 1)
  }>;
  commentsTimeline: CommentaryLine[];
}

export interface GeminiBrainAnalysis {
  momentumA: number; // 0-100
  momentumB: number; // 0-100
  possessionA: number;
  possessionB: number;
  shotsOnTargetA: number;
  shotsOnTargetB: number;
  tacticalAnalysis: string;
  alphaIdentified: boolean;
  alphaArbitragePct?: number; // Calculated discrepancy percentage
  tradingRecommendation?: string; // Buy YES Team A / Team B / Draw
  dramaticTrigger?: string; // Announcer screamed indicator if audio
  modelUsed: string;
  timestamp: string;
  isMocked: boolean;
  // Dynamic market estimations for advanced contracts
  trueProbA?: number;
  trueProbB?: number;
  trueProbDraw?: number;
  trueProbOver25?: number; // Estimated true probability of Over 2.5 Goals (0 to 100)
  trueProbNextA?: number;  // Estimated true probability that Team A scores next (0 to 100)
  trueProbNextB?: number;  // Estimated true probability that Team B scores next (0 to 100)
  targetContract?: string; // e.g., "Over 2.5 Goals", "Next Scorer (France)", "Winner (Japan)"
}

export interface ConnectedAppAlert {
  id: string;
  timestamp: string;
  matchTime: string;
  message: string;
  recipient: string;
  status: "sent" | "failed" | "delivered";
  arbitragePct: number;
  recommendation: string;
}

export interface AgentConfiguration {
  whatsappNumber: string;
  ingestionSpeedMs: number; // Speed of commentary updates
  alphaThreshold: number; // Minimum percentage mismatch to trigger alert (e.g., 10%)
  selectedModel: "gemini-3.5-flash" | "gemini-3.1-flash-live-preview";
  useAcousticListening: boolean; // Listening for "announcers screaming" Mode (Gemini Omni simulations)
}
