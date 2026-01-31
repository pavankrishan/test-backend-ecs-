# Build Artifacts Explanation

## What are these files?

You're seeing many `.js`, `.js.map`, `.d.ts`, and `.d.ts.map` files in your repository. These are **build artifacts** - files generated when TypeScript compiles your source code.

### File Types:

- **`.js`** - Compiled JavaScript files (generated from `.ts` files)
- **`.js.map`** - Source maps that help debug compiled code
- **`.d.ts`** - TypeScript declaration files (type definitions)
- **`.d.ts.map`** - Source maps for declaration files

## Why do they exist?

When TypeScript compiles your code, it can generate these files alongside your source files. However, these should typically be:

1. **Generated during build** - Not committed to the repository
2. **Stored in `dist/` folder** - Not alongside source files
3. **Ignored by git** - Via `.gitignore`

## The Problem

Currently, some TypeScript configurations are compiling files **in-place** (next to source files) instead of only in the `dist/` folder. This creates clutter and can cause issues:

- ❌ Harder to see actual source files
- ❌ Risk of committing build artifacts
- ❌ Unnecessary files in repository
- ❌ Potential conflicts if build process changes

## The Solution

### 1. Updated `.gitignore`

I've updated `kc-backend/.gitignore` to ignore these build artifacts:

```gitignore
# Ignore compiled files in shared directory
shared/**/*.js
shared/**/*.js.map
shared/**/*.d.ts
shared/**/*.d.ts.map
!shared/dist/**  # But allow dist folder content
```

### 2. Cleanup Script

A cleanup script is available to remove existing build artifacts:

```bash
# Dry run (see what would be deleted)
node scripts/clean-build-artifacts.js --dry-run

# Actually delete the files
pnpm clean-build-artifacts
# or
node scripts/clean-build-artifacts.js --yes
```

### 3. Remove from Git Tracking

If these files are already tracked by git, remove them:

```bash
# Remove from git tracking (files will still exist locally)
git rm --cached -r shared/**/*.js shared/**/*.js.map shared/**/*.d.ts shared/**/*.d.ts.map

# Commit the removal
git commit -m "Remove build artifacts from git tracking"
```

## Best Practices

1. **Build outputs should go to `dist/`** - Configure TypeScript to output only to `dist/`
2. **Never commit build artifacts** - Always ignore them in `.gitignore`
3. **Clean before committing** - Run cleanup script if needed
4. **Use CI/CD** - Build artifacts should be generated in CI, not in repo

## Why they appeared in `shared/`?

The `shared/` package uses `tsc --watch` in development mode, which can compile files alongside sources. The TypeScript config has `outDir: "./dist"`, but if you've run TypeScript directly (not through the build script), it may have compiled in-place.

## What to do now?

1. ✅ `.gitignore` is already updated
2. 🔄 Run cleanup script: `pnpm clean-build-artifacts`
3. 🔄 Remove from git if tracked: `git rm --cached -r shared/**/*.js ...`
4. ✅ Commit the changes

The files will be regenerated when you build, but they won't be committed to git anymore!


