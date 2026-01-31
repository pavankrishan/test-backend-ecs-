# Code Review: assignment.model.ts

## Summary
This file defines the Assignment and AssignmentSubmission models, database schema, and repository methods. Overall structure is good, but there are several critical issues that need to be addressed.

---

## 🔴 Critical Issues

### 1. **Schema Creation Order Problem** (Lines 95-162)
**Issue**: The code attempts to ALTER `assignment_submissions` table (lines 95-139) before ensuring it exists (line 141). This will fail on fresh database installations.

**Impact**: Application will crash on first run with a new database.

**Fix**: Move the `CREATE TABLE IF NOT EXISTS` before the `DO $$` block, or wrap the ALTER statements in a table existence check.

### 2. **Missing Foreign Key Constraint** (Line 146)
**Issue**: `course_id` in `assignment_submissions` table has no foreign key constraint to `courses(id)`, even though it's marked as NOT NULL.

**Impact**: Data integrity risk - orphaned submissions if courses are deleted.

**Fix**: Add `CONSTRAINT fk_submission_course FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE`

### 3. **Logic Mismatch in Submission Status** (Line 266)
**Issue**: `createSubmission` hardcodes status as `'submitted'`, but `AssignmentService.submitAssignment` checks if status is `'pending'` (assignment.service.ts:45).

**Impact**: The service check will never work correctly - submissions are created with 'submitted' status, so the check for 'pending' will always fail.

**Fix**: Either:
- Change line 266 to use `'pending'` status, OR
- Update the service to check for `'submitted'` status instead

### 4. **Duplicate Column Addition** (Lines 75 & 84)
**Issue**: The `order` column is defined in CREATE TABLE (line 75) and then added again with ALTER TABLE (line 84).

**Impact**: Redundant code, though `IF NOT EXISTS` prevents errors.

**Fix**: Remove the ALTER TABLE statement (line 83-85) since the column is already in CREATE TABLE.

---

## 🟡 Important Issues

### 5. **Type Safety - Using `any`** (Lines 187, 204)
**Issue**: `rowToAssignment` and `rowToSubmission` use `any` type for the row parameter.

**Impact**: Loss of type safety, potential runtime errors.

**Fix**: Define a proper type:
```typescript
interface AssignmentRow {
  id: string;
  course_id: string;
  title: string;
  // ... etc
}
```

### 6. **Missing Validation - Score Range** (Line 289)
**Issue**: `gradeSubmission` doesn't validate that `score <= maxScore` for the assignment.

**Impact**: Can grade submissions with scores higher than the maximum allowed.

**Fix**: Add validation:
```typescript
const assignment = await this.findById(submission.assignmentId);
if (score > assignment.maxScore) {
  throw new Error(`Score cannot exceed maximum score of ${assignment.maxScore}`);
}
```

### 7. **Missing Validation - Passing Score** (Line 225)
**Issue**: `create` method doesn't validate that `passingScore <= maxScore`.

**Impact**: Can create assignments with invalid passing scores.

**Fix**: Add validation in the `create` method.

### 8. **Missing Update Methods**
**Issue**: No methods to update assignments or submissions.

**Impact**: Cannot modify assignments or update submissions after creation.

**Recommendation**: Add `update` and `updateSubmission` methods.

### 9. **Missing Delete Methods**
**Issue**: No methods to delete assignments or submissions.

**Impact**: Cannot remove assignments or submissions programmatically.

**Recommendation**: Add `delete` and `deleteSubmission` methods.

---

## 🟢 Code Quality Improvements

### 10. **Error Handling**
**Issue**: Repository methods don't handle database errors explicitly.

**Recommendation**: Add try-catch blocks or let errors bubble up with proper error types.

### 11. **Transaction Support**
**Issue**: Operations like `createSubmission` + validation could benefit from transactions.

**Recommendation**: Consider adding transaction support for multi-step operations.

### 12. **Index Optimization**
**Issue**: Missing composite index on `(course_id, status)` for common queries like "get all pending submissions for a course".

**Recommendation**: Add composite indexes for frequently queried column combinations.

### 13. **Constraint on Score**
**Issue**: No CHECK constraint to ensure `score >= 0` and `score <= max_score` at database level.

**Recommendation**: Add database-level constraints for data integrity.

### 14. **Date Handling**
**Issue**: No timezone handling for `dueDate`, `submittedAt`, etc.

**Recommendation**: Consider using `TIMESTAMPTZ` instead of `TIMESTAMP` for timezone-aware dates.

---

## ✅ Positive Aspects

1. ✅ Good use of TypeScript interfaces
2. ✅ Proper use of parameterized queries (SQL injection protection)
3. ✅ Good indexing strategy for common queries
4. ✅ Proper foreign key relationships with CASCADE delete
5. ✅ Unique constraint on student-assignment combination
6. ✅ Migration-friendly approach with `IF NOT EXISTS` checks

---

## Recommended Priority Fixes

1. **HIGH**: Fix schema creation order (Issue #1)
2. **HIGH**: Fix submission status logic mismatch (Issue #3)
3. **HIGH**: Add foreign key constraint for course_id (Issue #2)
4. **MEDIUM**: Add type safety (Issue #5)
5. **MEDIUM**: Add score validation (Issues #6, #7)
6. **LOW**: Remove duplicate column addition (Issue #4)
7. **LOW**: Add update/delete methods (Issues #8, #9)

