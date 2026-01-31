# Student Profile Ownership

## Single source of truth

**student-service** is the authoritative owner of `student_profiles`. All profile writes go through student-service only. student-auth does **not** write to `student_profiles`; it either proxies update requests to student-service or reads only.

## Auth-needed subset

student-auth only needs a **read** subset of profile fields for auth flows (e.g. display name, address for sessions):

- `fullName`, `age`, `gender`, `address`, `extra`

Auth does **not** need to write latitude/longitude or other extended fields; student-service owns those.

## Guarantees

- **One writer:** Only student-service performs INSERT/UPDATE on `student_profiles`.
- **Auth no lat/long:** student-auth's legacy `upsertStudentProfile` asserts that `latitude` and `longitude` are never written by auth (throws if present).
- **API compatibility:** `PUT /api/v1/students/auth/profile` is supported by proxying to student-service so existing API contracts are preserved.
