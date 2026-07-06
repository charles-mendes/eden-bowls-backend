export type RecommendationPetResultDto = {
  petId: string;
  dailyGrams: number;
  monthlyGrams: number;
  kcalTarget: number | null;
  factors: Record<string, unknown>;
};

export type RecommendationResponseDto = {
  sessionId: string;
  recommendationVersion: string;
  marketCountry: string;
  currency: string;
  totalDailyGrams: number;
  totalMonthlyGrams: number;
  petResults: RecommendationPetResultDto[];
};
