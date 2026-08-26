import {
  formatRecommendationValidationEvalCaseResult,
  formatRecommendationValidationEvalSummary,
  runRecommendationValidationEvals,
  type RecommendationValidationEvalAggregateResult,
  type RecommendationValidationEvalRunnerDependencies,
} from './recommendation-validation-eval-runner.js';
import {
  recommendationValidationEvalCases,
  type RecommendationValidationEvalCase,
} from './recommendation-validation-evals.js';

export type RecommendationValidationEvalCliOptions = {
  readonly evalCases?: readonly RecommendationValidationEvalCase[];
  readonly dependencies?: RecommendationValidationEvalRunnerDependencies;
  readonly writeLine?: (line: string) => void;
  readonly setExitCode?: (code: number) => void;
};

/** Prints safe, deterministic eval results and returns the corresponding process exit code. */
export function runRecommendationValidationEvalCli(
  options: RecommendationValidationEvalCliOptions = {},
): RecommendationValidationEvalAggregateResult {
  const result = runRecommendationValidationEvals(
    options.evalCases ?? recommendationValidationEvalCases,
    options.dependencies,
  );
  const writeLine = options.writeLine ?? console.log;

  for (const caseResult of result.cases) {
    writeLine(formatRecommendationValidationEvalCaseResult(caseResult));
  }
  writeLine(formatRecommendationValidationEvalSummary(result));
  (options.setExitCode ?? ((code) => {
    process.exitCode = code;
  }))(result.passed ? 0 : 1);

  return result;
}
