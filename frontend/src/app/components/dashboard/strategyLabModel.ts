export type StrategyBand = "safe" | "balanced" | "ambitious" | "backup";

export type StrategyConfidence = "medium" | "low";
export type DataConfidenceStatus = "verified" | "unknown" | "placeholder";

export interface FieldConfidence {
  status: DataConfidenceStatus;
  reason?: string;
  value?: number | null;
  source?: string | null;
  source_url?: string | null;
  last_verified_year?: number | null;
}

export interface UniversityDataConfidence {
  median_grant_threshold?: FieldConfidence;
  max_grant_threshold?: FieldConfidence;
}

export interface StrategyUniversityOption {
  id: number;
  label: string;
  city?: string | null;
  majors_count?: number | null;
  median_grant_threshold?: number | null;
  max_grant_threshold?: number | null;
  popularity_rank?: number | null;
  popularity_score?: number | null;
  prestige_score?: number | null;
  data_confidence?: UniversityDataConfidence | null;
}

export interface StrategyChoice {
  band: StrategyBand;
  university: StrategyUniversityOption | null;
  threshold: number | null;
  margin: number | null;
  confidence: StrategyConfidence;
}

export type GrantPlanningStatus = "ready" | "uncertain" | "limited";
export type GrantPlanningAction =
  | "compare_verified"
  | "verify_data"
  | "expand_city"
  | "raise_score";

export interface GrantPlanningSummary {
  totalOptions: number;
  verifiedOptions: number;
  realisticOptions: number;
  reachOptions: number;
  backupOptions: number;
  missingDataOptions: number;
  placeholderOptions: number;
  coverageRatio: number;
  bestMargin: number | null;
  nearestGap: number | null;
  status: GrantPlanningStatus;
  primaryAction: GrantPlanningAction;
}

interface Candidate {
  university: StrategyUniversityOption;
  threshold: number;
  margin: number;
}

function verifiedPositive(value: number | null | undefined): number | null {
  return typeof value === "number" && value > 0 ? value : null;
}

function thresholdConfidence(
  university: StrategyUniversityOption,
  field: "median_grant_threshold" | "max_grant_threshold",
): FieldConfidence | null {
  return university.data_confidence?.[field] ?? null;
}

function verifiedThreshold(
  university: StrategyUniversityOption,
  field: "median_grant_threshold" | "max_grant_threshold",
): number | null {
  const value = verifiedPositive(university[field]);
  const confidence = thresholdConfidence(university, field);

  if (!confidence) {
    return value;
  }

  return confidence.status === "verified" ? value : null;
}

export function resolveGrantThreshold(
  university: StrategyUniversityOption,
): number | null {
  return (
    verifiedThreshold(university, "median_grant_threshold") ??
    verifiedThreshold(university, "max_grant_threshold")
  );
}

export function countMissingThresholds(
  universities: StrategyUniversityOption[],
): number {
  return universities.filter(
    (university) => resolveGrantThreshold(university) == null,
  ).length;
}

export function countPlaceholderThresholds(
  universities: StrategyUniversityOption[],
): number {
  return universities.filter(hasPlaceholderThreshold).length;
}

export function classifyGrantBand(
  currentScore: number,
  threshold: number | null,
): { band: StrategyBand; margin: number | null } {
  if (!threshold || currentScore <= 0) {
    return { band: "backup", margin: null };
  }

  const margin = currentScore - threshold;
  if (margin >= 12) {
    return { band: "safe", margin };
  }
  if (margin >= 0) {
    return { band: "balanced", margin };
  }
  if (margin >= -12) {
    return { band: "ambitious", margin };
  }
  return { band: "backup", margin };
}

function cityMatches(
  university: StrategyUniversityOption,
  preferredCity: string,
): boolean {
  return (
    preferredCity === "all" ||
    (university.city || "").trim().toLowerCase() ===
      preferredCity.trim().toLowerCase()
  );
}

function hasPlaceholderThreshold(
  university: StrategyUniversityOption,
): boolean {
  const median = thresholdConfidence(university, "median_grant_threshold");
  const max = thresholdConfidence(university, "max_grant_threshold");
  return (
    median?.status === "placeholder" ||
    max?.status === "placeholder" ||
    university.median_grant_threshold === 0 ||
    university.max_grant_threshold === 0
  );
}

function scoreCandidate(candidate: Candidate): number {
  const prestige = candidate.university.prestige_score ?? 0;
  const popularity = candidate.university.popularity_score ?? 0;
  const rankBonus = candidate.university.popularity_rank
    ? Math.max(0, 100 - candidate.university.popularity_rank)
    : 0;
  return prestige * 2 + popularity + rankBonus + candidate.threshold;
}

function pickCandidate(
  candidates: Candidate[],
  usedIds: Set<number>,
  band: StrategyBand,
): Candidate | null {
  const available = candidates.filter(
    (candidate) => !usedIds.has(candidate.university.id),
  );

  if (band === "safe") {
    return (
      available
        .filter((candidate) => candidate.margin >= 12)
        .sort((a, b) => scoreCandidate(b) - scoreCandidate(a))[0] ?? null
    );
  }

  if (band === "balanced") {
    return (
      available
        .filter((candidate) => candidate.margin >= 0 && candidate.margin < 12)
        .sort((a, b) => Math.abs(a.margin - 4) - Math.abs(b.margin - 4))[0] ??
      null
    );
  }

  if (band === "ambitious") {
    return (
      available
        .filter((candidate) => candidate.margin < 0 && candidate.margin >= -12)
        .sort((a, b) => b.threshold - a.threshold)[0] ?? null
    );
  }

  return (
    available
      .filter((candidate) => candidate.margin >= 0)
      .sort((a, b) => a.threshold - b.threshold)[0] ??
    available.sort((a, b) => b.margin - a.margin)[0] ??
    null
  );
}

export function buildFourChoiceStrategy(
  universities: StrategyUniversityOption[],
  currentScore: number,
  preferredCity = "all",
): StrategyChoice[] {
  const candidates = universities
    .filter((university) => cityMatches(university, preferredCity))
    .map((university) => {
      const threshold = resolveGrantThreshold(university);
      if (!threshold) {
        return null;
      }
      return {
        university,
        threshold,
        margin: currentScore - threshold,
      };
    })
    .filter((candidate): candidate is Candidate => candidate !== null);

  const usedIds = new Set<number>();
  return (["safe", "balanced", "ambitious", "backup"] as StrategyBand[]).map(
    (band) => {
      const candidate = pickCandidate(candidates, usedIds, band);
      if (!candidate) {
        return {
          band,
          university: null,
          threshold: null,
          margin: null,
          confidence: "low",
        };
      }
      usedIds.add(candidate.university.id);
      return {
        band,
        university: candidate.university,
        threshold: candidate.threshold,
        margin: candidate.margin,
        confidence: "medium",
      };
    },
  );
}

export function buildGrantPlanningSummary(
  universities: StrategyUniversityOption[],
  currentScore: number,
  preferredCity = "all",
): GrantPlanningSummary {
  const scoped = universities.filter((university) =>
    cityMatches(university, preferredCity),
  );
  let realisticOptions = 0;
  let reachOptions = 0;
  let backupOptions = 0;
  let missingDataOptions = 0;
  let placeholderOptions = 0;
  const margins: number[] = [];

  scoped.forEach((university) => {
    const threshold = resolveGrantThreshold(university);
    if (hasPlaceholderThreshold(university)) {
      placeholderOptions += 1;
    }
    if (!threshold) {
      missingDataOptions += 1;
      return;
    }

    const margin = currentScore - threshold;
    margins.push(margin);
    if (margin >= 0) {
      realisticOptions += 1;
    } else if (margin >= -12) {
      reachOptions += 1;
    } else {
      backupOptions += 1;
    }
  });

  const verifiedOptions = margins.length;
  const coverageRatio =
    scoped.length === 0
      ? 0
      : Math.round((verifiedOptions / scoped.length) * 100);
  const bestMargin = margins.length ? Math.max(...margins) : null;
  const nearestGap =
    margins.filter((margin) => margin < 0).sort((a, b) => b - a)[0] ?? null;

  let status: GrantPlanningStatus = "ready";
  let primaryAction: GrantPlanningAction = "compare_verified";

  if (scoped.length === 0) {
    status = "limited";
    primaryAction = "expand_city";
  } else if (verifiedOptions === 0 || coverageRatio < 35) {
    status = "limited";
    primaryAction = "verify_data";
  } else if (realisticOptions === 0) {
    status = "uncertain";
    primaryAction = reachOptions > 0 ? "raise_score" : "expand_city";
  } else if (missingDataOptions > 0 || placeholderOptions > 0) {
    status = "uncertain";
    primaryAction = "verify_data";
  }

  return {
    totalOptions: scoped.length,
    verifiedOptions,
    realisticOptions,
    reachOptions,
    backupOptions,
    missingDataOptions,
    placeholderOptions,
    coverageRatio,
    bestMargin,
    nearestGap,
    status,
    primaryAction,
  };
}
