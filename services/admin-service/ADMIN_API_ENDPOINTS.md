# Admin Panel API Endpoints

Complete list of all endpoints that should be implemented in the frontend admin panel based on the RBAC permission system.

## Base URL
```
/api/v1/admin
```

## Authentication Endpoints

### ✅ Already Implemented
- `POST /auth/login` - Admin login
- `POST /auth/refresh` - Refresh access token
- `GET /auth/me` - Get current admin profile
- `POST /auth/logout` - Logout current session
- `POST /auth/logout-all` - Logout all sessions

---

## 1. Admin Management Endpoints

### State Admin Management
- `POST /admins/state` - Create state admin
  - Permission: `admin:create:state_admin`
  - Body: `{ email, password, fullName, state, adminType: 'company' }`
  
- `GET /admins/state` - List all state admins
  - Permission: `admin:view`
  - Query: `?state=...&page=1&limit=10`
  
- `GET /admins/state/:id` - Get state admin details
  - Permission: `admin:view`
  
- `PUT /admins/state/:id` - Update state admin
  - Permission: `admin:update:state_admin`
  - Body: `{ fullName, state, status }`
  
- `DELETE /admins/state/:id` - Delete state admin
  - Permission: `admin:delete:state_admin`
  
- `POST /admins/state/:id/disable` - Disable state admin
  - Permission: `admin:disable`

### District Admin Management
- `POST /admins/district` - Create district admin
  - Permission: `admin:create:district_admin`
  - Body: `{ email, password, fullName, state, district, adminType: 'company' | 'franchise', parentAdminId? }`
  
- `GET /admins/district` - List district admins
  - Permission: `admin:view`
  - Query: `?state=...&district=...&adminType=...&page=1&limit=10`
  
- `GET /admins/district/:id` - Get district admin details
  - Permission: `admin:view`
  
- `PUT /admins/district/:id` - Update district admin
  - Permission: `admin:update:district_admin`
  - Body: `{ fullName, state, district, adminType, status }`
  
- `DELETE /admins/district/:id` - Delete district admin
  - Permission: `admin:delete:district_admin`
  
- `POST /admins/district/:id/disable` - Disable district admin
  - Permission: `admin:disable`

### Zone Admin Management
- `POST /admins/zone` - Create zone admin
  - Permission: `admin:create:zone_admin`
  - Body: `{ email, password, fullName, state, district, zone, adminType: 'company' | 'franchise', parentAdminId? }`
  
- `GET /admins/zone` - List zone admins
  - Permission: `admin:view`
  - Query: `?state=...&district=...&zone=...&adminType=...&page=1&limit=10`
  
- `GET /admins/zone/:id` - Get zone admin details
  - Permission: `admin:view`
  
- `PUT /admins/zone/:id` - Update zone admin
  - Permission: `admin:update:zone_admin`
  - Body: `{ fullName, state, district, zone, adminType, status }`
  
- `DELETE /admins/zone/:id` - Delete zone admin
  - Permission: `admin:delete:zone_admin`
  
- `POST /admins/zone/:id/disable` - Disable zone admin
  - Permission: `admin:disable`

### Locality Supervisor Management
- `POST /admins/locality` - Create locality supervisor
  - Permission: `admin:create:locality_supervisor`
  - Body: `{ email, password, fullName, state, district, zone, locality, adminType: 'company', parentAdminId? }`
  
- `GET /admins/locality` - List locality supervisors
  - Permission: `admin:view`
  - Query: `?state=...&district=...&zone=...&locality=...&page=1&limit=10`
  
- `GET /admins/locality/:id` - Get locality supervisor details
  - Permission: `admin:view`
  
- `PUT /admins/locality/:id` - Update locality supervisor
  - Permission: `admin:update:locality_supervisor`
  - Body: `{ fullName, state, district, zone, locality, status }`
  
- `DELETE /admins/locality/:id` - Delete locality supervisor
  - Permission: `admin:delete:locality_supervisor`
  
- `POST /admins/locality/:id/disable` - Disable locality supervisor
  - Permission: `admin:disable`

### General Admin Endpoints
- `GET /admins` - List all admins (filtered by role and location)
  - Permission: `admin:view`
  - Query: `?role=...&state=...&district=...&zone=...&adminType=...&status=...&page=1&limit=10`
  
- `GET /admins/:id` - Get admin details
  - Permission: `admin:view`
  
- `GET /admins/:id/permissions` - Get admin permissions
  - Permission: `admin:view`
  
- `GET /admins/:id/hierarchy` - Get admin hierarchy (parent and children)
  - Permission: `admin:view`
  
- `GET /admins/roles` - Get all available roles
  - Permission: `admin:view`
  
- `GET /admins/permissions` - Get all available permissions
  - Permission: `admin:view`

---

## 2. Franchise Management Endpoints

### Franchise Accounts
- `POST /franchises` - Create franchise account
  - Permission: `franchise:create`
  - Body: `{ name, email, phone, address, state, district, commissionRate, ownerDetails }`
  
- `GET /franchises` - List franchises
  - Permission: `franchise:view_performance` | `franchise:inspect`
  - Query: `?state=...&district=...&status=...&page=1&limit=10`
  
- `GET /franchises/:id` - Get franchise details
  - Permission: `franchise:view_performance` | `franchise:inspect`
  
- `PUT /franchises/:id` - Update franchise
  - Permission: `franchise:update`
  - Body: `{ name, email, phone, address, status }`
  
- `DELETE /franchises/:id` - Delete franchise
  - Permission: `franchise:delete`
  
- `POST /franchises/:id/approve` - Approve franchise
  - Permission: `franchise:approve`
  - Body: `{ approvedBy, notes }`
  
- `PUT /franchises/:id/commission` - Set franchise commission
  - Permission: `franchise:set_commission`
  - Body: `{ commissionRate }`
  
- `GET /franchises/:id/performance` - Get franchise performance
  - Permission: `franchise:view_performance`
  - Query: `?startDate=...&endDate=...`
  
- `POST /franchises/:id/inspect` - Inspect franchise
  - Permission: `franchise:inspect`
  - Body: `{ inspectionDate, notes, rating }`
  
- `GET /franchises/:id/inspections` - Get franchise inspection history
  - Permission: `franchise:inspect`

### Franchise Sub-Admins
- `POST /franchises/:franchiseId/admins` - Create franchise sub-admin
  - Permission: `franchise:create_sub_admin`
  - Body: `{ email, password, fullName, role, permissions }`
  
- `GET /franchises/:franchiseId/admins` - List franchise sub-admins
  - Permission: `franchise:view_performance`
  
- `DELETE /franchises/:franchiseId/admins/:adminId` - Delete franchise sub-admin
  - Permission: `franchise:create_sub_admin`

---

## 3. Zone Management Endpoints

- `POST /zones` - Create zone
  - Permission: `zone:create`
  - Body: `{ name, state, district, description }`
  
- `GET /zones` - List zones
  - Permission: `admin:view`
  - Query: `?state=...&district=...&page=1&limit=10`
  
- `GET /zones/:id` - Get zone details
  - Permission: `admin:view`
  
- `PUT /zones/:id` - Update zone
  - Permission: `zone:update`
  - Body: `{ name, description, status }`
  
- `DELETE /zones/:id` - Delete zone
  - Permission: `zone:delete`
  
- `POST /zones/:id/assign-admin` - Assign zone admin
  - Permission: `zone:assign_admin`
  - Body: `{ adminId }`
  
- `GET /zones/:id/admins` - Get zone admins
  - Permission: `admin:view`

---

## 4. Tutor Management Endpoints

### Tutor CRUD
- `GET /tutors` - List tutors
  - Permission: `tutor:manage`
  - Query: `?state=...&district=...&zone=...&status=...&page=1&limit=10`
  
- `GET /tutors/:id` - Get tutor details
  - Permission: `tutor:manage`
  
- `PUT /tutors/:id` - Update tutor details
  - Permission: `tutor:edit_details`
  - Body: `{ name, email, phone, address, subjects, ... }`
  
- `DELETE /tutors/:id` - Delete tutor
  - Permission: `tutor:manage`

### Tutor Approval
- `GET /tutors/pending` - List pending tutor applications
  - Permission: `tutor:approve`
  - Query: `?state=...&district=...&page=1&limit=10`
  
- `POST /tutors/:id/approve` - Approve tutor
  - Permission: `tutor:approve`
  - Body: `{ approvedBy, notes }`
  
- `POST /tutors/:id/reject` - Reject tutor
  - Permission: `tutor:reject`
  - Body: `{ reason, notes }`
  
- `POST /tutors/:id/block` - Block tutor
  - Permission: `tutor:block`
  - Body: `{ reason }`

### Tutor Assignment
- `POST /tutors/:tutorId/assign-student` - Assign tutor to student
  - Permission: `tutor:assign`
  - Body: `{ studentId, subject, schedule }`
  
- `DELETE /tutors/:tutorId/assign-student/:assignmentId` - Unassign tutor from student
  - Permission: `tutor:assign`

### Tutor Documents & Verification
- `GET /tutors/:id/documents` - Get tutor documents
  - Permission: `tutor:manage`
  
- `POST /tutors/:id/documents` - Upload tutor documents
  - Permission: `tutor:update_documents` (company only)
  - Body: `FormData with documents`
  
- `POST /tutors/:id/verify-address` - Verify tutor address
  - Permission: `tutor:verify_address`
  - Body: `{ verified, notes }`
  
- `POST /tutors/:id/onboard` - Assist tutor onboarding
  - Permission: `tutor:onboard`
  - Body: `{ onboardingSteps, notes }`

### Tutor Attendance & Performance
- `GET /tutors/:id/attendance` - Get tutor attendance
  - Permission: `tutor:view_attendance`
  - Query: `?startDate=...&endDate=...`
  
- `GET /tutors/:id/performance` - Get tutor performance
  - Permission: `tutor:view_performance`
  - Query: `?startDate=...&endDate=...`
  
- `GET /tutors/attendance` - Get all tutors attendance
  - Permission: `tutor:view_attendance`
  - Query: `?state=...&district=...&zone=...&date=...`
  
- `POST /tutors/:id/track-arrival` - Track tutor arrival
  - Permission: `tutor:track_arrival`
  - Body: `{ location, timestamp }`

---

## 5. Student Management Endpoints

### Student CRUD
- `GET /students` - List students
  - Permission: `student:manage`
  - Query: `?state=...&district=...&zone=...&locality=...&status=...&page=1&limit=10`
  
- `GET /students/:id` - Get student details
  - Permission: `student:view`
  
- `POST /students` - Create student
  - Permission: `student:manage`
  - Body: `{ name, email, phone, address, parentDetails, ... }`
  
- `PUT /students/:id` - Update student
  - Permission: `student:manage`
  - Body: `{ name, email, phone, address, ... }`
  
- `DELETE /students/:id` - Remove student
  - Permission: `student:remove`
  
- `POST /students/:id/block` - Block student
  - Permission: `student:block`
  - Body: `{ reason }`

### Student-Tutor Assignment
- `POST /students/:studentId/assign-tutor` - Assign student to tutor
  - Permission: `student:assign_tutor`
  - Body: `{ tutorId, subject, schedule }`
  
- `GET /students/:id/tutors` - Get student's tutors
  - Permission: `student:view`
  
- `DELETE /students/:studentId/tutors/:tutorId` - Unassign tutor from student
  - Permission: `student:assign_tutor`

---

## 6. Finance Endpoints

### Revenue & Analytics
- `GET /finance/analytics/platform` - Get platform-wide analytics
  - Permission: `finance:view_platform_analytics`
  - Query: `?startDate=...&endDate=...`
  - Returns: `{ totalStudents, totalTutors, totalClasses, revenue, attendance }`
  
- `GET /finance/revenue` - Get revenue data
  - Permission: `finance:view_revenue`
  - Query: `?state=...&district=...&zone=...&startDate=...&endDate=...`
  
- `GET /finance/revenue/district/:districtId` - Get district revenue
  - Permission: `finance:view_district_revenue`
  - Query: `?startDate=...&endDate=...`
  
- `GET /finance/revenue/zone/:zoneId` - Get zone revenue
  - Permission: `finance:view_zone_revenue`
  - Query: `?startDate=...&endDate=...`
  
- `GET /finance/revenue/franchise/:franchiseId` - Get franchise revenue
  - Permission: `finance:view_franchise_revenue`
  - Query: `?startDate=...&endDate=...`

### Financial Data
- `GET /finance/data` - Get financial data (limited)
  - Permission: `finance:view_financial_data`
  - Query: `?state=...&district=...&zone=...&startDate=...&endDate=...`
  
- `GET /finance/data/full` - Get full financial data
  - Permission: `finance:view_full_financial_data` (company only)
  - Query: `?state=...&district=...&startDate=...&endDate=...`

### Franchise Payouts
- `GET /finance/payouts` - List franchise payouts
  - Permission: `finance:approve_payout`
  - Query: `?status=...&franchiseId=...&page=1&limit=10`
  
- `GET /finance/payouts/:id` - Get payout details
  - Permission: `finance:approve_payout`
  
- `POST /finance/payouts/:id/approve` - Approve franchise payout
  - Permission: `finance:approve_payout`
  - Body: `{ approvedBy, notes }`
  
- `POST /finance/payouts/:id/reject` - Reject franchise payout
  - Permission: `finance:approve_payout`
  - Body: `{ reason }`

### Session Fees & Pricing
- `GET /finance/session-fees` - Get session fees
  - Permission: `finance:view_financial_data`
  
- `PUT /finance/session-fees` - Set session fees
  - Permission: `finance:set_session_fees`
  - Body: `{ subjectId, fee, currency }`
  
- `GET /finance/tax-invoices` - Get tax invoices
  - Permission: `finance:view_tax_invoices`
  - Query: `?franchiseId=...&startDate=...&endDate=...&page=1&limit=10`
  
- `GET /finance/tax-invoices/:id` - Get tax invoice details
  - Permission: `finance:view_tax_invoices`
  
- `POST /finance/tax-invoices/:id/generate` - Generate tax invoice
  - Permission: `finance:view_tax_invoices`

---

## 7. Analytics Endpoints

### Platform Analytics
- `GET /analytics/platform` - Get platform-wide analytics
  - Permission: `analytics:view_total_students` | `analytics:view_total_tutors` | `analytics:view_completed_classes`
  - Query: `?startDate=...&endDate=...`
  - Returns: `{ totalStudents, totalTutors, totalClasses, revenue, attendance }`
  
- `GET /analytics/students/total` - Get total students count
  - Permission: `analytics:view_total_students`
  - Query: `?state=...&district=...&zone=...`
  
- `GET /analytics/tutors/total` - Get total tutors count
  - Permission: `analytics:view_total_tutors`
  - Query: `?state=...&district=...&zone=...`
  
- `GET /analytics/classes/completed` - Get completed classes count
  - Permission: `analytics:view_completed_classes`
  - Query: `?startDate=...&endDate=...&state=...&district=...&zone=...`
  
- `GET /analytics/attendance` - Get attendance data
  - Permission: `analytics:view_attendance`
  - Query: `?startDate=...&endDate=...&state=...&district=...&zone=...`

### District Performance
- `GET /analytics/district/:districtId/performance` - Get district performance
  - Permission: `analytics:view_district_performance`
  - Query: `?startDate=...&endDate=...`
  - Returns: `{ revenue, sessions, tutorActivity, studentCount, ... }`
  
- `GET /analytics/district/:districtId/tutor-activity` - Get district tutor activity
  - Permission: `analytics:view_tutor_activity`
  - Query: `?startDate=...&endDate=...`

### Ratings & Feedback
- `GET /analytics/ratings` - Get ratings and feedback
  - Permission: `analytics:view_ratings_feedback`
  - Query: `?state=...&district=...&zone=...&tutorId=...&studentId=...&page=1&limit=10`
  
- `GET /analytics/ratings/:id` - Get rating details
  - Permission: `analytics:view_ratings_feedback`

---

## 8. Safety Endpoints

### SOS Alerts
- `GET /safety/sos` - Get SOS alerts (filtered by permission level)
  - Permission: `safety:view_all_sos` | `safety:view_state_sos` | `safety:view_district_sos` | `safety:view_zone_sos` | `safety:view_sos`
  - Query: `?state=...&district=...&zone=...&status=...&priority=...&page=1&limit=10`
  
- `GET /safety/sos/all` - Get all SOS alerts (platform-wide)
  - Permission: `safety:view_all_sos`
  - Query: `?status=...&priority=...&page=1&limit=10`
  
- `GET /safety/sos/state/:stateId` - Get state SOS alerts
  - Permission: `safety:view_state_sos`
  - Query: `?status=...&priority=...&page=1&limit=10`
  
- `GET /safety/sos/district/:districtId` - Get district SOS alerts
  - Permission: `safety:view_district_sos`
  - Query: `?status=...&priority=...&page=1&limit=10`
  
- `GET /safety/sos/zone/:zoneId` - Get zone SOS alerts
  - Permission: `safety:view_zone_sos`
  - Query: `?status=...&priority=...&page=1&limit=10`
  
- `GET /safety/sos/:id` - Get SOS alert details
  - Permission: `safety:view_all_sos` | `safety:view_state_sos` | `safety:view_district_sos` | `safety:view_zone_sos` | `safety:view_sos`
  
- `PUT /safety/sos/:id/status` - Update SOS alert status
  - Permission: `safety:view_all_sos` | `safety:view_state_sos` | `safety:view_district_sos` | `safety:view_zone_sos`
  - Body: `{ status, notes }`
  
- `POST /safety/sos/:id/override` - Override franchise decision on SOS alert
  - Permission: `safety:override_franchise` (company only)
  - Body: `{ action, reason }`

### Safety Incidents
- `POST /safety/incidents` - Report safety incident
  - Permission: `safety:report_incident`
  - Body: `{ type, description, location, severity, involvedParties, ... }`
  
- `GET /safety/incidents` - Get safety incidents
  - Permission: `safety:report_incident` | `safety:view_all_sos`
  - Query: `?state=...&district=...&zone=...&type=...&severity=...&page=1&limit=10`
  
- `GET /safety/incidents/:id` - Get safety incident details
  - Permission: `safety:report_incident` | `safety:view_all_sos`
  
- `PUT /safety/incidents/:id` - Update safety incident
  - Permission: `safety:report_incident`
  - Body: `{ status, notes, resolution }`

---

## 9. Content & Platform Endpoints

### Subjects
- `GET /content/subjects` - Get all subjects
  - Permission: `content:view`
  - Query: `?page=1&limit=10`
  
- `GET /content/subjects/:id` - Get subject details
  - Permission: `content:view`
  
- `POST /content/subjects` - Create subject
  - Permission: `content:edit_subjects`
  - Body: `{ name, description, category, ... }`
  
- `PUT /content/subjects/:id` - Update subject
  - Permission: `content:edit_subjects`
  - Body: `{ name, description, category, ... }`
  
- `DELETE /content/subjects/:id` - Delete subject
  - Permission: `content:edit_subjects`

### Class Types
- `GET /content/class-types` - Get all class types
  - Permission: `content:view`
  
- `GET /content/class-types/:id` - Get class type details
  - Permission: `content:view`
  
- `POST /content/class-types` - Create class type
  - Permission: `content:edit_class_types`
  - Body: `{ name, description, duration, ... }`
  
- `PUT /content/class-types/:id` - Update class type
  - Permission: `content:edit_class_types`
  - Body: `{ name, description, duration, ... }`
  
- `DELETE /content/class-types/:id` - Delete class type
  - Permission: `content:edit_class_types`

### Pricing
- `GET /content/pricing` - Get pricing for all subjects
  - Permission: `content:view`
  - Query: `?subjectId=...&state=...&district=...`
  
- `GET /content/pricing/:id` - Get pricing details
  - Permission: `content:view`
  
- `POST /content/pricing` - Set pricing for subject
  - Permission: `content:set_pricing`
  - Body: `{ subjectId, state, district, zone, price, currency, ... }`
  
- `PUT /content/pricing/:id` - Update pricing
  - Permission: `content:set_pricing`
  - Body: `{ price, currency, ... }`
  
- `DELETE /content/pricing/:id` - Delete pricing
  - Permission: `content:set_pricing`

---

## 10. Operations Endpoints

### Class Management
- `GET /operations/classes` - List classes
  - Permission: `operations:manage_classes`
  - Query: `?state=...&district=...&zone=...&tutorId=...&studentId=...&status=...&date=...&page=1&limit=10`
  
- `GET /operations/classes/:id` - Get class details
  - Permission: `operations:manage_classes`
  
- `POST /operations/classes` - Create class
  - Permission: `operations:manage_classes`
  - Body: `{ tutorId, studentId, subject, schedule, location, ... }`
  
- `PUT /operations/classes/:id` - Update class
  - Permission: `operations:manage_classes`
  - Body: `{ schedule, location, status, ... }`
  
- `DELETE /operations/classes/:id` - Delete class
  - Permission: `operations:manage_classes`

### Class Schedules
- `GET /operations/schedules` - Get class schedules
  - Permission: `operations:approve_schedules`
  - Query: `?state=...&district=...&zone=...&status=...&date=...&page=1&limit=10`
  
- `GET /operations/schedules/pending` - Get pending schedules
  - Permission: `operations:approve_schedules`
  - Query: `?state=...&district=...&page=1&limit=10`
  
- `POST /operations/schedules/:id/approve` - Approve class schedule
  - Permission: `operations:approve_schedules`
  - Body: `{ approvedBy, notes }`
  
- `POST /operations/schedules/:id/reject` - Reject class schedule
  - Permission: `operations:approve_schedules`
  - Body: `{ reason }`

### Attendance
- `GET /operations/attendance` - Get attendance data
  - Permission: `operations:monitor_attendance`
  - Query: `?state=...&district=...&zone=...&date=...&tutorId=...&studentId=...&page=1&limit=10`
  
- `POST /operations/attendance` - Submit attendance (backup mode)
  - Permission: `operations:submit_attendance`
  - Body: `{ classId, tutorId, studentId, status, timestamp, ... }`
  
- `POST /operations/classes/:classId/verify-completion` - Verify class completion via OTP
  - Permission: `operations:verify_completion`
  - Body: `{ otp, verifiedBy, notes }`

### Tutor Visits & Tracking
- `POST /operations/tutors/:tutorId/mark-visit` - Mark tutor visit
  - Permission: `operations:mark_visits`
  - Body: `{ location, timestamp, notes }`
  
- `GET /operations/tutors/:tutorId/visits` - Get tutor visits
  - Permission: `operations:mark_visits`
  - Query: `?startDate=...&endDate=...`
  
- `POST /operations/tutors/:tutorId/track-arrival` - Track tutor arrival/exit
  - Permission: `operations:track_arrival_exit`
  - Body: `{ type: 'arrival' | 'exit', location, timestamp }`
  
- `GET /operations/tutors/:tutorId/arrival-tracking` - Get tutor arrival tracking
  - Permission: `operations:track_arrival_exit`
  - Query: `?date=...`

### Complaints
- `GET /operations/complaints` - Get complaints
  - Permission: `operations:handle_complaints`
  - Query: `?state=...&district=...&zone=...&locality=...&type=...&status=...&page=1&limit=10`
  
- `GET /operations/complaints/:id` - Get complaint details
  - Permission: `operations:handle_complaints`
  
- `POST /operations/complaints/:id/handle` - Handle complaint
  - Permission: `operations:handle_complaints`
  - Body: `{ status, resolution, notes }`
  
- `GET /operations/complaints/parental` - Get parental complaints
  - Permission: `operations:handle_parental_complaints`
  - Query: `?locality=...&status=...&page=1&limit=10`
  
- `POST /operations/complaints/parental/:id/handle` - Handle parental complaint
  - Permission: `operations:handle_parental_complaints`
  - Body: `{ status, resolution, notes }`

### On-Ground Issues
- `GET /operations/issues` - Get on-ground issues
  - Permission: `operations:solve_issues`
  - Query: `?state=...&district=...&zone=...&locality=...&type=...&status=...&page=1&limit=10`
  
- `GET /operations/issues/:id` - Get issue details
  - Permission: `operations:solve_issues`
  
- `POST /operations/issues` - Report on-ground issue
  - Permission: `operations:solve_issues`
  - Body: `{ type, description, location, priority, ... }`
  
- `PUT /operations/issues/:id` - Update issue
  - Permission: `operations:solve_issues`
  - Body: `{ status, resolution, notes }`
  
- `POST /operations/issues/:id/resolve` - Resolve issue
  - Permission: `operations:solve_issues`
  - Body: `{ resolution, notes }`

### Staff Requests
- `GET /operations/staff-requests` - Get staff requests
  - Permission: `operations:approve_staff_requests`
  - Query: `?state=...&district=...&status=...&page=1&limit=10`
  
- `GET /operations/staff-requests/:id` - Get staff request details
  - Permission: `operations:approve_staff_requests`
  
- `POST /operations/staff-requests/:id/approve` - Approve staff request
  - Permission: `operations:approve_staff_requests`
  - Body: `{ approvedBy, notes }`
  
- `POST /operations/staff-requests/:id/reject` - Reject staff request
  - Permission: `operations:approve_staff_requests`
  - Body: `{ reason }`

---

## 11. Audit & Logs Endpoints

### System Logs
- `GET /audit/logs` - Get system logs
  - Permission: `audit:view_system_logs`
  - Query: `?level=...&module=...&startDate=...&endDate=...&page=1&limit=10`
  
- `GET /audit/logs/:id` - Get log details
  - Permission: `audit:view_system_logs`

### Audit Trail
- `GET /audit/trail` - Get audit trail (who changed what)
  - Permission: `audit:view_audit_trail`
  - Query: `?entityType=...&entityId=...&adminId=...&action=...&startDate=...&endDate=...&page=1&limit=10`
  
- `GET /audit/trail/:id` - Get audit trail entry details
  - Permission: `audit:view_audit_trail`
  
- `GET /audit/trail/changes` - Get who changed what
  - Permission: `audit:view_changes`
  - Query: `?entityType=...&entityId=...&startDate=...&endDate=...&page=1&limit=10`

---

## 12. Dashboard Endpoints

### Dashboard Overview
- `GET /dashboard/overview` - Get dashboard overview
  - Permission: Multiple permissions based on role
  - Query: `?state=...&district=...&zone=...&startDate=...&endDate=...`
  - Returns: `{ stats, recentActivities, alerts, ... }`
  
- `GET /dashboard/stats` - Get dashboard statistics
  - Permission: Multiple permissions based on role
  - Query: `?state=...&district=...&zone=...&startDate=...&endDate=...`
  - Returns: `{ students, tutors, classes, revenue, attendance, ... }`
  
- `GET /dashboard/recent-activities` - Get recent activities
  - Permission: `admin:view`
  - Query: `?limit=10`
  
- `GET /dashboard/alerts` - Get dashboard alerts
  - Permission: Multiple permissions based on role
  - Query: `?type=...&priority=...&limit=10`

---

## Common Query Parameters

Most list endpoints support:
- `page` - Page number (default: 1)
- `limit` - Items per page (default: 10, max: 100)
- `sort` - Sort field (e.g., `createdAt`, `name`)
- `order` - Sort order (`asc` or `desc`, default: `desc`)
- `search` - Search query
- `state` - Filter by state
- `district` - Filter by district
- `zone` - Filter by zone
- `locality` - Filter by locality
- `status` - Filter by status
- `startDate` - Start date filter
- `endDate` - End date filter

---

## Response Format

All endpoints return JSON in the following format:

### Success Response
```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "page": 1,
    "limit": 10,
    "total": 100,
    "totalPages": 10
  }
}
```

### Error Response
```json
{
  "success": false,
  "error": {
    "message": "Error message",
    "code": "ERROR_CODE",
    "statusCode": 400
  }
}
```

---

## Authentication

All endpoints (except `/auth/login` and `/auth/refresh`) require authentication:
- Header: `Authorization: Bearer <access_token>`
- The access token is obtained from the login endpoint

---

## Permission Levels

Endpoints are protected by permission middleware. Each endpoint requires specific permissions based on:
1. Role (super_admin, state_admin, district_admin, zone_admin, locality_supervisor)
2. Admin Type (company or franchise)
3. Location (state, district, zone, locality)

Permissions are automatically checked based on the admin's role, type, and location scope.

---

## Notes

1. **Location Filtering**: All endpoints automatically filter data based on the admin's location scope (state, district, zone, locality).

2. **Company vs Franchise**: Franchise admins have restricted access compared to company admins for the same role level.

3. **Hierarchy**: Admins can only manage admins below them in the hierarchy.

4. **Permissions**: Each endpoint checks for specific permissions before allowing access.

5. **Pagination**: All list endpoints support pagination with `page` and `limit` query parameters.

6. **Date Filters**: Most analytics and reporting endpoints support `startDate` and `endDate` query parameters.

7. **Search**: Most list endpoints support search functionality via the `search` query parameter.

---

## Implementation Priority

1. **High Priority** (Core Functionality):
   - Authentication endpoints ✅
   - Admin management endpoints
   - Tutor management endpoints
   - Student management endpoints
   - Dashboard endpoints
   - Analytics endpoints

2. **Medium Priority** (Operations):
   - Finance endpoints
   - Operations endpoints
   - Safety endpoints
   - Content endpoints

3. **Low Priority** (Advanced Features):
   - Franchise management endpoints
   - Zone management endpoints
   - Audit & logs endpoints

---

This document should be used as a reference for implementing the frontend admin panel. Each endpoint should be implemented with proper permission checks and error handling.

