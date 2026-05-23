import { MatchScenario } from "./types";

export const MATCH_SCENARIOS: MatchScenario[] = [
  {
    id: "euro-final-2026",
    sport: "Soccer",
    teamA: "France",
    teamAImage: "🇫🇷",
    teamB: "Spain",
    teamBImage: "🇪🇸",
    venue: "Olympiastadion, Berlin",
    description: "UEFA Euro Final. France is playing with a high press, while Spain defends deep. Polymarket crowd is heavily valuing Spain based on historical ball retrieval metrics.",
    polymarketOddsTimeline: [
      { yesA: 0.38, yesB: 0.44, draw: 0.18, over25: 0.34, nextScorerA: 0.36, nextScorerB: 0.40 },
      { yesA: 0.38, yesB: 0.44, draw: 0.18, over25: 0.34, nextScorerA: 0.36, nextScorerB: 0.40 },
      { yesA: 0.39, yesB: 0.43, draw: 0.18, over25: 0.35, nextScorerA: 0.37, nextScorerB: 0.39 },
      { yesA: 0.38, yesB: 0.45, draw: 0.17, over25: 0.35, nextScorerA: 0.36, nextScorerB: 0.41 },
      { yesA: 0.37, yesB: 0.46, draw: 0.17, over25: 0.36, nextScorerA: 0.35, nextScorerB: 0.42 },
      { yesA: 0.36, yesB: 0.47, draw: 0.17, over25: 0.36, nextScorerA: 0.34, nextScorerB: 0.43 },
      { yesA: 0.35, yesB: 0.49, draw: 0.16, over25: 0.37, nextScorerA: 0.33, nextScorerB: 0.45 },
      { yesA: 0.35, yesB: 0.49, draw: 0.16, over25: 0.37, nextScorerA: 0.33, nextScorerB: 0.45 }, // Odds sleeping!
      { yesA: 0.34, yesB: 0.50, draw: 0.16, over25: 0.38, nextScorerA: 0.32, nextScorerB: 0.46 },
      { yesA: 0.33, yesB: 0.52, draw: 0.15, over25: 0.39, nextScorerA: 0.31, nextScorerB: 0.48 },
      { yesA: 0.32, yesB: 0.53, draw: 0.15, over25: 0.39, nextScorerA: 0.30, nextScorerB: 0.49 },
      { yesA: 0.31, yesB: 0.55, draw: 0.14, over25: 0.40, nextScorerA: 0.29, nextScorerB: 0.51 }
    ],
    commentsTimeline: [
      {
        timeOffset: "72'",
        text: "Midfield stalemate continues. Spain keeps 61% possession but executes lateral passes with zero forward depth.",
        intensity: "neutral",
        teamFocus: "B"
      },
      {
        timeOffset: "74'",
        text: "France triggers high press. Camavinga intercepts in the center circle and switches play immediately.",
        intensity: "neutral",
        teamFocus: "A"
      },
      {
        timeOffset: "76'",
        text: "Kounde swings high deep cross! Spain centerback Laporte struggles, headers it weakly back to the edge of the box.",
        intensity: "high",
        teamFocus: "A"
      },
      {
        timeOffset: "78'",
        text: "France is keeping 82% possession and has generated 4 consecutive quick transitions in Spain's final third.",
        intensity: "high",
        teamFocus: "A"
      },
      {
        timeOffset: "80'",
        text: "Mbappe bursts down the left flank! LAPORTE SLIPS! Mbappe has clear path on goal, Spain defense is utterly shattered!",
        intensity: "critical",
        audioTranscription: "MBAPPE BREAKS AWAY ON THE FLANK! UNBELIEVABLE SPEED! SPAIN IS IN DEEP TROUBLE!!!",
        teamFocus: "A"
      },
      {
        timeOffset: "82'",
        text: "Mbappe shoots hard near post! Unbelievable diving save by Raya! Corner kick France. Spain defender Laporte is screaming at his midfielders for failing to screen.",
        intensity: "critical",
        audioTranscription: "WHAT A SAVE BY RAYA! MBAPPE NEARLY BROKE THE NET!!! CORNER FRANCE!",
        teamFocus: "A"
      },
      {
        timeOffset: "84'",
        text: "France maintains absolute siege on Spain's penalty box. Dembele launches a low projectile, deflected wide. Spain looking physically exhausted.",
        intensity: "high",
        teamFocus: "A"
      },
      {
        timeOffset: "86'",
        text: "Corner headed away, but falls straight back to Camavinga who dictates pace outside. Spain has zero forward options left.",
        intensity: "neutral",
        teamFocus: "neutral"
      }
    ]
  },
  {
    id: "cl-madrid-city",
    sport: "Soccer",
    teamA: "Real Madrid",
    teamAImage: "👑",
    teamB: "Manchester City",
    teamBImage: "🩵",
    venue: "Santiago Bernabeu, Madrid",
    description: "UEFA Champions League Semifinal. Manchester City dominates the ball and has 22 total shots, but Real Madrid's classic transition blocks are loaded for counter-attack alpha.",
    polymarketOddsTimeline: [
      { yesA: 0.28, yesB: 0.55, draw: 0.17, over25: 0.44, nextScorerA: 0.26, nextScorerB: 0.52 },
      { yesA: 0.29, yesB: 0.54, draw: 0.17, over25: 0.45, nextScorerA: 0.27, nextScorerB: 0.51 },
      { yesA: 0.28, yesB: 0.56, draw: 0.16, over25: 0.46, nextScorerA: 0.26, nextScorerB: 0.53 },
      { yesA: 0.27, yesB: 0.57, draw: 0.16, over25: 0.47, nextScorerA: 0.25, nextScorerB: 0.54 },
      { yesA: 0.25, yesB: 0.60, draw: 0.15, over25: 0.48, nextScorerA: 0.23, nextScorerB: 0.57 },
      { yesA: 0.24, yesB: 0.61, draw: 0.15, over25: 0.49, nextScorerA: 0.22, nextScorerB: 0.58 },
      { yesA: 0.25, yesB: 0.60, draw: 0.15, over25: 0.50, nextScorerA: 0.23, nextScorerB: 0.57 },
      { yesA: 0.24, yesB: 0.61, draw: 0.15, over25: 0.50, nextScorerA: 0.22, nextScorerB: 0.58 },
      { yesA: 0.23, yesB: 0.63, draw: 0.14, over25: 0.51, nextScorerA: 0.21, nextScorerB: 0.60 },
      { yesA: 0.22, yesB: 0.64, draw: 0.14, over25: 0.52, nextScorerA: 0.20, nextScorerB: 0.61 }
    ],
    commentsTimeline: [
      {
        timeOffset: "65'",
        text: "Grealish cuts inside, shoots wide. Man City is taking up lines deep inside Madrid half. Real Madrid is in block compact shape.",
        intensity: "neutral",
        teamFocus: "B"
      },
      {
        timeOffset: "67'",
        text: "City continues heavy spatial squeeze. Bernardo Silva plays a short combination but Rudiger intercepts calmly.",
        intensity: "neutral",
        teamFocus: "neutral"
      },
      {
        timeOffset: "69'",
        text: "Rudiger triggers bullet pass straight into Vinicius Jr! City has left high gaps with their centerbacks in Madrid half.",
        intensity: "high",
        teamFocus: "A"
      },
      {
        timeOffset: "71'",
        text: "Vinicius Jr outruns Walker over 30 yards! He cuts a low square ball across the pitch to Valverde!",
        intensity: "critical",
        audioTranscription: "VINICIUS SPRINTING! VALVERDE IS UNMARKED IN THE CENTER! VALVERDE POWER STRIKE OVER THE CROSSBAR!!!",
        teamFocus: "A"
      },
      {
        timeOffset: "73'",
        text: "Man City attempts to regain spatial lock but midfielder Rodri looks heavily fatigued, misplaced backpass seized by Bellingham.",
        intensity: "high",
        teamFocus: "A"
      },
      {
        timeOffset: "75'",
        text: "Bellingham chips over the defensive wall! Vinicius Jr is through! He volleys it cleanly!",
        intensity: "critical",
        audioTranscription: "BELLINGHAM DEEP CHIP... VINICIUS JR VOLLEY! GOOOOOOOOOOAL REAL MADRID!!! SHOCKED SILENCE AT THE CITIZENS CORNER!",
        teamFocus: "A"
      }
    ]
  },
  {
    id: "nfl-cowboys-49ers",
    sport: "Football",
    teamA: "Dallas Cowboys",
    teamAImage: "⭐",
    teamB: "San Francisco 49ers",
    teamBImage: "🏈",
    venue: "Levi's Stadium, Santa Clara",
    description: "4th Quarter, 4 minutes left. 49ers have a 3-point lead but their starting defensive tackle just left with a quad injury. Cowboys are launching a high-tempo aerial offensive drive.",
    polymarketOddsTimeline: [
      { yesA: 0.30, yesB: 0.70, draw: 0.00, over25: 0.55, nextScorerA: 0.35, nextScorerB: 0.65 },
      { yesA: 0.31, yesB: 0.69, draw: 0.00, over25: 0.56, nextScorerA: 0.36, nextScorerB: 0.64 },
      { yesA: 0.32, yesB: 0.68, draw: 0.00, over25: 0.57, nextScorerA: 0.37, nextScorerB: 0.63 },
      { yesA: 0.33, yesB: 0.67, draw: 0.00, over25: 0.58, nextScorerA: 0.38, nextScorerB: 0.62 },
      { yesA: 0.32, yesB: 0.68, draw: 0.00, over25: 0.58, nextScorerA: 0.37, nextScorerB: 0.63 },
      { yesA: 0.32, yesB: 0.68, draw: 0.00, over25: 0.59, nextScorerA: 0.37, nextScorerB: 0.63 },
      { yesA: 0.31, yesB: 0.69, draw: 0.00, over25: 0.60, nextScorerA: 0.36, nextScorerB: 0.64 }
    ],
    commentsTimeline: [
      {
        timeOffset: "4:00",
        text: "49ers star tackle Bosa limps off the field with medical staff. Immediate tactical vulnerability recognized.",
        intensity: "high",
        teamFocus: "A"
      },
      {
        timeOffset: "3:30",
        text: "Cowboys quarterback Dak Prescott sets up in shot-gun. No pass rush pressure. Prescott fires deep left to Lamb for 19 yards!",
        intensity: "high",
        teamFocus: "A"
      },
      {
        timeOffset: "3:00",
        text: "Hurry-up offense initiated by Cowboys. Prescott locks eye, fires over the center to Ferguson for another 12 yards!",
        intensity: "high",
        teamFocus: "A"
      },
      {
        timeOffset: "2:15",
        text: "49ers defense looks highly disoriented without Bosa. Prescott finds a massive spacing gap in the red zone!",
        intensity: "critical",
        audioTranscription: "DACK PRESCOTT LOOKING DEEP... HE FIRES INTO THE CORNER... TOUCHDOWN COWBOYS!!! UNBELIEVABLE DRIVE!!!",
        teamFocus: "A"
      }
    ]
  }
];
