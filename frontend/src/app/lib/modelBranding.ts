export const SAMGA_FREE_MODEL = "Samga-S1.1";
export const SAMGA_PREMIUM_MODEL = "Samga-S1.1-thinking";

export function toSamgaModelName(
  _rawModel?: string | null,
  isPremium = false,
): string {
  return isPremium ? SAMGA_PREMIUM_MODEL : SAMGA_FREE_MODEL;
}
