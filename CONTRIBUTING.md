# Contributing

Oli uses small, reviewable feature branches. Each production change should map to a GitHub issue and a pull request.

## Workflow

1. Create a branch from `main` using the feature prefix pattern.
2. Link the issue in the PR body.
3. Run `npm run check` and `npm test`.
4. Update the relevant docs.
5. Open the PR using the repository template.
6. Reviewers should inspect privacy, error handling, platform behavior, and tests before merge.

The repository includes CODEOWNERS and a PR checklist. GitHub branch-protection approval counts still need to be enabled in repository settings by the maintainer.
