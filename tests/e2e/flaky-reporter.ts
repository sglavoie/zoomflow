import { appendFileSync } from 'node:fs';
import { relative } from 'node:path';
import type { Reporter, TestCase } from '@playwright/test/reporter';

/** Reports tests that passed only on retry as GitHub warnings and in the job summary.
 * Flaky tests do not fail the run, so this keeps each one visible on the pull request. */
export default class FlakyReporter implements Reporter {
  private readonly flaky: TestCase[] = [];

  onTestEnd(test: TestCase) {
    if (test.outcome() === 'flaky' && !this.flaky.includes(test)) this.flaky.push(test);
  }

  onEnd() {
    if (!this.flaky.length || !process.env.GITHUB_ACTIONS) return;
    const lines = this.flaky.map((test) => {
      const file = relative(process.cwd(), test.location.file);
      const project = test.parent.project()?.name ?? '';
      const title = `[${project}] ${test.titlePath().slice(3).join(' › ')}`;
      console.log(`::warning file=${file},line=${test.location.line}::Flaky test (passed on retry): ${title}`);
      return `- \`${file}:${test.location.line}\` ${title}`;
    });
    const summary = process.env.GITHUB_STEP_SUMMARY;
    if (summary) appendFileSync(summary, `### Flaky tests\n\nThese passed only on retry; their traces are in the uploaded report.\n\n${lines.join('\n')}\n`);
  }

  printsToStdio() {
    return false;
  }
}
