# PugArch Connect Portal — Technical & Functional Documentation

**Version:** 5.0  
**Platform:** connect.pugarch.in  
**Classification:** Internal Technical Reference  
**Date:** November 2026

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [System Architecture](#2-system-architecture)
3. [Technology Stack](#3-technology-stack)
4. [Application Modules & Features](#4-application-modules--features)
   - 4.1 Grievance Management Module
   - 4.2 Appointment Management Module
   - 4.3 WhatsApp Chatbot & Flow Engine
   - 4.4 Lead Capture Module
   - 4.5 Analytics & Reporting Module
   - 4.6 Notifications Module
5. [User Roles & Access Control (RBAC)](#5-user-roles--access-control-rbac)
6. [Business Logic & Workflows](#6-business-logic--workflows)
   - 6.1 Grievance Lifecycle
   - 6.2 SLA Escalation Engine
   - 6.3 Appointment Lifecycle
   - 6.4 WhatsApp Flow Engine
7. [Data Models](#7-data-models)
8. [API Reference Summary](#8-api-reference-summary)
9. [Multi-Tenancy Architecture](#9-multi-tenancy-architecture)
10. [Security & Compliance](#10-security--compliance)
11. [Integrations](#11-integrations)
12. [Deployment & Infrastructure](#12-deployment--infrastructure)
13. [Configuration Reference](#13-configuration-reference)
14. [Glossary](#14-glossary)

---

## 1. Executive Summary

**PugArch Connect** is a multi-tenant, WhatsApp-first citizen engagement and grievance redressal platform built for government (and enterprise) organisations. It enables citizens to register complaints, book appointments, and track their requests entirely through WhatsApp — without installing any application. Administrative staff access a web-based dashboard to manage, assign, escalate, and resolve these requests.

### Core Value Propositions

| Capability | Description |
|---|---|
| **WhatsApp-native citizen interface** | Citizens interact via familiar WhatsApp messaging; no app download required |
| **Automated chatbot flows** | Configurable multi-step conversation flows collect citizen data, route to departments, and auto-create records |
| **SLA-driven escalation** | Automated 3-level escalation (Officer → Department Head → District Collector) when SLA is breached |
| **Multi-tenant** | A single platform instance serves multiple independent organisations (companies), each fully isolated |
| **Multi-language** | Supports English, Hindi (hi), Odia (or), and Marathi (mr) in chatbot and notifications |
| **Real-time notifications** | Dual-channel notifications (WhatsApp + Email) to officers and citizens at every workflow step |
| **Audit trail** | Immutable audit logs for every action, with timestamps and actor identity |

---

## 2. System Architecture

### 2.1 High-Level Architecture

```
                    Citizens (WhatsApp)
                           │
                           ▼
              Meta WhatsApp Business API
                           │
                     Webhook POST
                           │
                           ▼
         ┌────────────────────────────────────────┐
         │          GCP Cloud Run Container        │
         │                                        │
         │  ┌──────────┐    ┌────────────────┐    │
         │  │  Nginx   │───▶│ Express API    │    │
         │  │ (Port    │    │ (Port 5001)    │    │
         │  │  8080)   │    │ TypeScript     │    │
         │  └──────────┘    └───────┬────────┘    │
         │       │                  │             │
         │       │          ┌───────▼────────┐    │
         │       │          │ Dynamic Flow   │    │
         │       │          │ Engine         │    │
         │       │          │ (WhatsApp Bot) │    │
         │       │          └───────┬────────┘    │
         │       │                  │             │
         │  ┌────▼──────┐           │             │
         │  │ Next.js   │           │             │
         │  │ Dashboard │           │             │
         │  │ (Port 3000│           │             │
         │  └───────────┘           │             │
         └──────────────────────────┼─────────────┘
                                    │
              ┌─────────────────────┼──────────────────────┐
              │                     │                      │
              ▼                     ▼                      ▼
        MongoDB Atlas          Redis Cache           GCS Bucket
        (Primary DB)         (Sessions &           (Media Files:
                              Rate Limits)       Images, Documents)
```

### 2.2 Request Routing

| Path Pattern | Destination | Description |
|---|---|---|
| `/` and `/_next/*` | Next.js (Port 3000) | Frontend dashboard |
| `/api/*` | Express (Port 5001) | REST API |
| `/webhook` | Express (Port 5001) | WhatsApp incoming messages |
| `/api/webhook` | Express (Port 5001) | Alternate webhook path |
| `/api/whatsapp` | Express (Port 5001) | WhatsApp API alias |
| `/health` | Express (Port 5001) | Health check endpoint |

### 2.3 Deployment Topology

- **Cloud Provider:** Google Cloud Platform (GCP)
- **Runtime:** Cloud Run (Managed Serverless Container)
- **Container:** Single unified Docker container running both Next.js and Express via Supervisord
- **Process Manager:** Supervisord (monitors and restarts both Node processes)
- **Port:** 8080 (Nginx ingress, dynamically injected by Cloud Run)
- **Database:** MongoDB Atlas (or any MongoDB-compatible cluster)
- **Cache:** Redis (optional — has in-memory fallback for rate limits and sessions)
- **Media Storage:** Google Cloud Storage (GCS)
- **Domain:** connect.pugarch.in / sahaj.pugarch.in

---

## 3. Technology Stack

### 3.1 Backend

| Technology | Version | Purpose |
|---|---|---|
| **Node.js** | LTS (20.x) | JavaScript runtime |
| **TypeScript** | ^5.3 | Type-safe development |
| **Express.js** | ^4.22 | HTTP server & REST API framework |
| **Mongoose** | ^8.21 | MongoDB ODM |
| **MongoDB** | Atlas (8.x) | Primary data store |
| **Redis / ioredis** | ^5.3 | Session storage & rate limiting |
| **jsonwebtoken** | ^9.0 | JWT authentication |
| **bcryptjs** | ^2.4 | Password hashing |
| **Helmet** | ^7.1 | HTTP security headers |
| **express-rate-limit** | ^7.1 | Rate limiting middleware |
| **Nodemailer** | ^6.10 | Email notifications |
| **Axios** | ^1.6 | HTTP client (WhatsApp API calls) |
| **Multer** | ^2.0 | File upload handling |
| **XLSX** | ^0.18 | Excel import/export |
| **Winston** | ^3.11 | Structured logging |
| **Zod / Joi** | ^3.22 / ^17.11 | Input validation |
| **Google Cloud Storage** | ^7.19 | Media file storage |
| **Bull** | ^4.12 | Background job queue |
| **Morgan** | ^1.10 | HTTP request logging |

### 3.2 Frontend

| Technology | Version | Purpose |
|---|---|---|
| **Next.js** | ^14.2 | React framework with App Router |
| **React** | ^18.2 | UI component library |
| **TypeScript** | ^5.3 | Type-safe development |
| **Tailwind CSS** | ^3.4 | Utility-first CSS |
| **Radix UI** | Various | Accessible UI primitives |
| **ReactFlow** | ^11.11 | Visual chatbot flow builder canvas |
| **Recharts** | ^2.10 | Data visualization / charts |
| **React Leaflet** | ^4.2 | Interactive maps & geolocation |
| **SWR** | ^2.2 | Data fetching & caching |
| **React Hook Form** | ^7.49 | Form state management |
| **Zod** | ^3.22 | Form validation schemas |
| **DnD Kit** | ^6.3 | Drag-and-drop interactions |
| **Lucide React** | ^0.562 | Icon library |
| **Axios** | ^1.6 | API client |
| **date-fns** | ^4.1 | Date formatting |
| **XLSX** | ^0.18 | Client-side Excel export |

---

## 4. Application Modules & Features

The platform supports the following configurable modules, which can be selectively enabled per company:

| Module Key | Description |
|---|---|
| `GRIEVANCE` | Citizen complaint registration and management |
| `APPOINTMENT` | Appointment booking and scheduling |
| `DOCUMENT_UPLOAD` | Media/file attachment to records |
| `GEO_LOCATION` | GPS location capture on grievances |
| `AUTO_NOTIFICATION` | Automated WhatsApp notifications |
| `EMAIL_NOTIFICATION` | Automated email notifications |
| `REPORT_DOWNLOAD` | Excel/CSV report export |
| `CUSTOMER_SUPPORT` | General support/enquiry flows |
| `ASSIGNMENT_WHATSAPP` | WhatsApp notification on assignment |
| `STATUS_UPDATE_WHATSAPP` | WhatsApp notification on status changes |
| `COMPANY_INFO` | Company information chatbot flow |
| `STATUS_TRACKING` | Citizen self-service status lookup |
| `LEAD_CAPTURE` | Business lead capture via WhatsApp |
| `HIERARCHICAL_DEPARTMENTS` | Parent-child department structure |
| `ANALYTICS` | Advanced analytics and KPI dashboards |

---

### 4.1 Grievance Management Module

#### Overview
The Grievance module is the core module. Citizens submit complaints via WhatsApp chatbot. Administrative staff review, assign, and resolve them from the dashboard.

#### Key Features

**For Citizens (via WhatsApp Chatbot):**
- Submit a grievance by selecting department, entering description, and optionally attaching media (image/document)
- Receive WhatsApp confirmation with a unique Grievance ID (e.g., `GRV000001`)
- Track grievance status by sending the ID or using the tracking flow
- Receive real-time status update notifications in WhatsApp

**For Administrative Staff (Dashboard):**
- View all grievances in a filterable, paginated list
- Filter by: status, department, date range, assignee, flagged status
- Assign grievances to specific officers
- Update status with remarks at each step
- Revert grievances back to previous department/officer
- Attach media (evidence, resolution docs)
- View full timeline history of every action
- Flag grievances for priority attention
- Export grievance data to Excel/CSV
- Bulk import grievances from Excel
- View SLA breach indicators
- Access the "Defaulters Ledger" (officers with persistently overdue grievances)

#### Grievance Status Lifecycle

```
PENDING → ASSIGNED → IN_PROGRESS → RESOLVED
              ↓                        ↓
           REVERTED ←←←←←←←←←←← (re-opens)
              ↓
          REJECTED
```

| Status | Description |
|---|---|
| `PENDING` | Newly submitted; awaiting assignment |
| `ASSIGNED` | Assigned to an officer |
| `IN_PROGRESS` | Officer is actively working on it |
| `REVERTED` | Sent back for revision or re-routing |
| `RESOLVED` | Officer has resolved it |
| `REJECTED` | Rejected with reason |

#### Grievance Data Fields

| Field | Type | Description |
|---|---|---|
| `grievanceId` | String | Auto-generated unique ID (e.g., `GRV000001`, per company) |
| `citizenName` | String | Citizen's full name |
| `citizenPhone` | String | Normalized phone number |
| `citizenWhatsApp` | String | WhatsApp number (if different) |
| `description` | String | Complaint description |
| `category` | String | Optional category tag |
| `status` | Enum | Current lifecycle status |
| `departmentId` | ObjectId | Primary department reference |
| `subDepartmentId` | ObjectId | Sub-department (hierarchical) |
| `additionalDepartmentIds` | ObjectId[] | Additional involved departments |
| `assignedTo` | ObjectId | Assigned officer user reference |
| `media` | Array | Attached files (images, docs, videos) |
| `location` | GeoJSON Point | GPS coordinates + address |
| `slaHours` | Number | SLA window in hours (default: 120 hrs) |
| `slaDueDate` | Date | Computed SLA deadline |
| `reminderCount` | Number | Number of automated reminders sent |
| `statusHistory` | Array | Full audit of every status change |
| `timeline` | Array | Chronological activity log |
| `isFlagged` | Boolean | Priority flag |
| `language` | Enum | Citizen's language (en/hi/mr/or) |
| `admin_consent` | Boolean | Consent flag for processing |

---

### 4.2 Appointment Management Module

#### Overview
Allows citizens to request appointments with government officers via WhatsApp. Administrators schedule and manage appointments from the dashboard.

#### Key Features
- Citizens request appointments via chatbot (purpose, preferred date/time)
- Administrators view pending appointment requests and schedule them
- Availability calendar for managing officer booking slots
- Status tracking with notification at each step
- Officer assignment for appointments

#### Appointment Status Lifecycle

```
REQUESTED → SCHEDULED → CONFIRMED → COMPLETED
                              ↓
                          CANCELLED
```

| Status | Description |
|---|---|
| `REQUESTED` | Citizen has requested; pending admin review |
| `SCHEDULED` | Admin has scheduled date/time |
| `CONFIRMED` | Confirmed by admin |
| `COMPLETED` | Appointment took place |
| `CANCELLED` | Cancelled with reason |

#### Appointment Data Fields

| Field | Type | Description |
|---|---|---|
| `appointmentId` | String | Auto-generated ID (e.g., `APT000001`) |
| `citizenName` | String | Citizen name |
| `citizenPhone` | String | Contact phone |
| `purpose` | String | Reason for appointment |
| `appointmentDate` | Date | Scheduled date |
| `appointmentTime` | String | Time slot |
| `duration` | Number | Duration in minutes (default: 30) |
| `location` | String | Meeting venue |
| `assignedTo` | ObjectId | Assigned officer |
| `statusHistory` | Array | Status change log |
| `timeline` | Array | Full activity history |

---

### 4.3 WhatsApp Chatbot & Flow Engine

#### Overview
The Dynamic Flow Engine is the intelligence layer that processes every incoming WhatsApp message and drives citizen conversations. Flows are defined per company using a visual drag-and-drop Flow Builder (ReactFlow canvas) in the admin dashboard.

#### Flow Architecture

Each company has one or more **Chatbot Flows**, each comprising:

| Component | Description |
|---|---|
| **Flow** | A named, versioned conversation template (e.g., "Grievance Submission", "Appointment Booking") |
| **Steps** | Individual nodes in the conversation (message, buttons, input, list, condition, etc.) |
| **Triggers** | Keywords or events that activate a flow (e.g., "hi", "hello", "menu_grievance") |
| **Sessions** | Per-citizen state maintained between messages (Redis + MongoDB fallback) |

#### Step Types

| Step Type | Description |
|---|---|
| `start` | Entry point of the flow |
| `message` | Sends a plain text message to the citizen |
| `buttons` | Presents up to 3 interactive quick-reply buttons |
| `list` | Presents a scrollable list of options (up to 10 items per section) |
| `input` | Collects user input (text, number, phone, email, date, image, document, location) |
| `media` | Sends or receives a media file |
| `condition` | Branches the flow based on a field value |
| `api_call` | Makes an external HTTP call |
| `delay` | Waits for a configured duration before proceeding |
| `assign_department` | Routes to the matching department |
| `dynamic_response` | Generates response from dynamic data (e.g., live department list) |
| `end` | Terminates the conversation flow |

#### Multi-Language Support
The flow engine picks the best-fit message text in this priority order:
1. `messageTextTranslations[citizenLanguage]` (e.g., `messageTextTranslations["hi"]`)
2. `messageTextTranslations["en"]`
3. `messageText` (default fallback)

#### Session Management
- **Primary Store:** Redis (sub-millisecond session reads)
- **Fallback Store:** MongoDB `WhatsAppSession` collection (when Redis is unavailable)
- **Session Timeout:** Configurable per flow (default: 30 minutes of inactivity)
- **Duplicate Message Prevention:** Processed message IDs are cached in `ProcessedWhatsAppMessage` to prevent replay

#### Flow Builder (Visual Canvas)
The admin dashboard provides a visual drag-and-drop editor built on **ReactFlow**:
- Add, connect, and configure step nodes on a canvas
- Preview step types: Message, Buttons, List, Input, Media, Condition, API Call
- Translate messages per language inline
- Save and activate flows per company
- Support for multiple flow types: `grievance`, `appointment`, `tracking`, `custom`

---

### 4.4 Lead Capture Module

Captures business leads from WhatsApp interactions. Used by enterprise companies.

| Field | Description |
|---|---|
| `leadId` | Auto-generated ID (e.g., `LEAD000001`) |
| `name` | Lead contact name |
| `projectType` | Type of project/enquiry |
| `projectDescription` | Detailed description |
| `budgetRange` | Estimated budget |
| `timeline` | Expected project timeline |
| `email` / `phone` | Contact details |
| `source` | Origin: `whatsapp`, `web`, `manual` |
| `status` | `NEW`, `CONTACTED`, `QUALIFIED`, `CONVERTED`, `LOST` |
| `assignedTo` | Assigned sales officer |

---

### 4.5 Analytics & Reporting Module

#### Dashboard KPIs
Real-time statistics visible on the main dashboard:
- Total grievances (by status breakdown)
- Resolution rate (%)
- Average resolution time
- SLA compliance rate
- Active pending cases count
- Department-wise load

#### Detailed Analytics
- Grievance trends over time (bar/line charts via Recharts)
- Department-wise performance comparison
- Officer-wise case load and resolution metrics
- Geographic distribution of complaints (heat map via Leaflet)
- Appointment volume and completion rates

#### Export Capabilities
- Export grievances to Excel (`.xlsx`) or CSV
- Filter by date range, department, status before export
- Full data export (SuperAdmin) or scoped data export (Company/Department Admin)

#### Import Capabilities
- Bulk import grievances from Excel template
- Batch size: 500 records per batch
- Max import rows: 10,000 per file
- Supported formats: `.xlsx`, `.csv`

---

### 4.6 Notifications Module

The platform sends dual-channel notifications (WhatsApp + Email) to citizens and officers at key workflow events.

#### Notification Events

| Event | Citizen | Officer | Dept Head | Company Admin |
|---|---|---|---|---|
| `grievance_created` | ✓ WhatsApp | ✓ | — | — |
| `grievance_assigned` | ✓ WhatsApp | ✓ | — | — |
| `grievance_status_update` | ✓ WhatsApp | — | — | — |
| `grievance_resolved` | ✓ WhatsApp | — | — | — |
| `grievance_reverted` | — | ✓ | — | — |
| `grievance_reminder` (SLA breach) | — | ✓ | ✓ (Level 2+) | ✓ (Level 3) |
| `appointment_created` | ✓ WhatsApp | ✓ | — | — |
| `appointment_scheduled` | ✓ WhatsApp | ✓ | — | — |

#### Notification Customisation
- Per-company notification settings (enable/disable per channel per event)
- Per-user notification override (officer can disable specific event types)
- WhatsApp templates are pre-approved via Meta Business API
- Email templates are configurable per company via dashboard

#### In-App Notifications
- Real-time bell notifications visible in the dashboard header
- Notification read/unread state tracking
- Notifications stored in `Notification` collection

---

## 5. User Roles & Access Control (RBAC)

### 5.1 Role Hierarchy

```
Level 0:  SUPER_ADMIN          (Platform-wide; manages all companies)
Level 1:  COMPANY_ADMIN        (Full access within own company)
Level 2+: Custom Roles         (Company-defined: Department Head, Officer, etc.)
```

### 5.2 System Roles

| Role | Level | Scope | Capabilities |
|---|---|---|---|
| `SUPER_ADMIN` | 0 | Platform | Create companies, manage all companies, view cross-company data, manage platform configuration, access all APIs |
| `COMPANY_ADMIN` | 1 | Company | Full CRUD on all resources within their company, manage departments, users, roles, WhatsApp config, flow builder |
| Custom Role (e.g. "Department Head") | 2–5 | Department/Sub-dept | Configured permissions per module per action |
| Custom Role (e.g. "Field Officer") | 5 | Assigned records | View and update assigned grievances/appointments only |

### 5.3 Permission Model

Permissions are structured as `module + action` pairs:

| Module | Available Actions |
|---|---|
| `GRIEVANCE` | `view`, `create`, `update`, `delete`, `assign`, `status_change`, `revert` |
| `APPOINTMENT` | `view`, `create`, `update`, `delete`, `status_change` |
| `USER_MANAGEMENT` | `view`, `create`, `update`, `delete` |
| `DEPARTMENTS` | `view`, `create`, `update`, `delete` |
| `ANALYTICS` | `view`, `export` |
| `FLOW_BUILDER` | `view`, `create`, `update`, `delete` |
| `SETTINGS` | `update`, `view_audit` |

### 5.4 Access Scopes

| Scope | Description |
|---|---|
| `company` | Can view/manage all records in the company |
| `department` | Restricted to records within assigned department(s) |
| `subdepartment` | Restricted to a specific sub-department |
| `assigned` | Only sees records directly assigned to them |

### 5.5 JWT Authentication

- JWT tokens issued on login (Bearer token in `Authorization` header)
- Tokens also accepted via `?token=` query param (for webhook-safe routes)
- Access control resolved at request time by `resolveUserAccess()` utility
- Company suspension check on every authenticated request
- Password reset via OTP delivered to email or WhatsApp

### 5.6 SSO Support

- SSO login endpoint at `/auth/sso`
- Rate-limited (50 attempts per 15 minutes per IP)

---

## 6. Business Logic & Workflows

### 6.1 Grievance Lifecycle

```
1. CITIZEN MESSAGE (WhatsApp)
        │
        ▼
2. WEBHOOK RECEIVED (Express)
   - Verify Meta signature
   - Deduplicate by message ID
        │
        ▼
3. DYNAMIC FLOW ENGINE
   - Load company's active chatbot flow
   - Restore citizen session (Redis → MongoDB fallback)
   - Determine current flow step
   - Process citizen input (text / button / media / location)
   - Advance to next step or branch on condition
        │
        ▼
4. GRIEVANCE CREATION (on form completion)
   - Auto-generate grievanceId (atomic counter, per-company)
   - Set SLA due date = createdAt + slaHours
   - Initialize statusHistory and timeline
   - Save to MongoDB
   - Send WhatsApp confirmation to citizen
   - Notify company admins (in-app + WhatsApp)
        │
        ▼
5. ADMIN ASSIGNMENT
   - Admin selects officer → status changes to ASSIGNED
   - Push timeline entry
   - Notify officer via WhatsApp + Email + In-app
        │
        ▼
6. OFFICER WORK
   - Officer updates status to IN_PROGRESS
   - Can add remarks, media attachments
        │
        ▼
7. RESOLUTION / REJECTION / REVERSION
   - On RESOLVED: citizen gets WhatsApp notification, resolvedAt timestamp set
   - On REJECTED: citizen gets WhatsApp notification with remarks
   - On REVERTED: re-routed to previous or new department/officer
        │
        ▼
8. CLOSED
   - closedAt timestamp set
   - SLA metrics computed
```

### 6.2 SLA Escalation Engine

The SLA Escalation Cron runs **every 1 hour**. It scans all active, assigned grievances across all active companies and enforces a 3-level escalation protocol:

#### Escalation Levels

| Level | Trigger | Action | Recipients |
|---|---|---|---|
| **Level 1** | SLA hours exceeded (default: 120 hrs), 0 reminders sent | Send Reminder #1 | Assigned Officer (WhatsApp + In-app) |
| **Level 2** | 48 hours after Reminder #1, still unresolved | Send Reminder #2; mark as potential defaulter | Officer + Department Head (WhatsApp + In-app) |
| **Level 3** | 24 hours after Reminder #2, still unresolved | Escalate to Collector; flag in Defaulters Ledger | Company Admin (Collector level) via In-app |

#### Defaulters Ledger
- Officers who fail to resolve after Level 2 reminders are marked in the Defaulters Ledger
- Accessible from the dashboard under "Grievance Defaulters"
- Administrators can mark a defaulter as "ignored" to suppress further automated escalation

#### SLA Configuration
- Default SLA: **120 hours** (5 working days)
- Configurable per company in `Company.slaSettings.defaultSlaHours`
- SLA due date is computed at grievance creation: `slaDueDate = createdAt + slaHours`

### 6.3 Appointment Lifecycle

```
1. CITIZEN requests appointment via WhatsApp chatbot
2. Record created with status REQUESTED
3. ADMIN reviews and schedules (sets date, time, duration, location)
   → Status: SCHEDULED
   → Citizen receives WhatsApp confirmation
4. ADMIN confirms appointment
   → Status: CONFIRMED
5. Appointment occurs
   → Admin marks as COMPLETED
   OR
   → Admin marks as CANCELLED with reason
```

#### Availability Calendar
- Officers and departments can define available time slots
- Prevents double-booking by checking existing appointments
- Accessible from the "Appointments" section in the dashboard

### 6.4 WhatsApp Flow Engine — Step-by-Step

For each incoming WhatsApp message:

1. **Webhook received** → verify Meta signature (HMAC-SHA256)
2. **Deduplication check** → query `ProcessedWhatsAppMessage` by message ID
3. **Load company** → identify company by WhatsApp phone number ID
4. **Load flow** → fetch active chatbot flow from cache (`FlowCacheService`) or MongoDB
5. **Load/create session** → Redis lookup; MongoDB fallback if Redis offline
6. **Language detection** → citizen's selected language stored in session
7. **Process step** →
   - `buttons`: match button_id from response
   - `list`: match list row ID
   - `input`: validate against `inputConfig.validation`, save to session context
   - `media`: upload to GCS, store URL in session
   - `location`: parse GPS coordinates
   - `condition`: evaluate `conditionConfig` against session fields
8. **Advance to nextStepId** → determined by step logic or expected response match
9. **Send WhatsApp response** → via Meta Graph API v18.0
10. **Persist session** → save updated session state to Redis (+ MongoDB)

---

## 7. Data Models

### 7.1 Company

Represents an independent tenant (government body or enterprise).

```
companyId        String     Unique ID (CMP000001)
name             String     Company name
nameHi/Or/Mr     String     Multi-language names
companyType      Enum       GOVERNMENT | CUSTOM_ENTERPRISE
enabledModules   String[]   List of active modules
selectedLanguages String[]  Supported languages (always includes 'en')
theme            Object     primaryColor, secondaryColor, logoUrl
slaSettings      Object     defaultSlaHours (default: 120)
notificationSettings Object Role-based notification preferences
isActive         Boolean
isSuspended      Boolean
permissionsVersion Number   For cache-busting permissions
```

### 7.2 User

Represents any user in the system (SuperAdmin, Company Admin, Officer, etc.)

```
userId           String     Unique ID (USER000001, per company)
firstName        String
lastName         String
email            String     (unique per company)
phone            String     Normalized E.164 format (unique per company)
designations     String[]   Multiple designations supported
departmentIds    ObjectId[] Multiple department assignments
companyId        ObjectId
role             String     Role string (e.g. 'COMPANY_ADMIN')
level            Number     Auth level
customRoleId     ObjectId   Points to custom Role document
isSuperAdmin     Boolean
isActive         Boolean
notificationSettings Object Per-user channel & event preferences
responsibleAreas String[]   Forest FSM module area codes
```

### 7.3 Department

```
departmentId          String     Unique ID (DEPT000001)
companyId             ObjectId
parentDepartmentId    ObjectId   For hierarchical structure (nullable)
name                  String
nameHi/Or/Mr          String     Multi-language names
description           String
contactPerson/Email/Phone String  Dept contact info
contactUserId         ObjectId   Link to User record
displayOrder          Number     For ordering in chatbot lists
isActive              Boolean
```

### 7.4 Role (Custom RBAC)

```
roleId       String     Unique ID
companyId    ObjectId
level        Number     Authorization level
scope        Enum       company | department | subdepartment | assigned
name         String     e.g. "Department Head", "Field Officer"
description  String
isSystem     Boolean    System roles cannot be deleted
permissions  Array      [{module, actions[]}]
```

### 7.5 Grievance

*(See Section 4.1 for full field listing)*

Key indices: `companyId + status`, `companyId + grievanceId` (unique), `assignedTo + status`, `departmentId + status`, `createdAt`

### 7.6 Appointment

*(See Section 4.2 for full field listing)*

Key indices: `companyId + status`, `companyId + appointmentId` (unique), `departmentId + appointmentDate`

### 7.7 ChatbotFlow

```
flowId              String     Auto-generated (FLOW000001)
companyId           ObjectId
flowName            String
flowType            Enum       grievance | appointment | tracking | custom
isActive            Boolean
version             Number
startStepId         String     ID of the entry step
steps               Array      Array of FlowStep objects
triggers            Array      [{triggerType, triggerValue, startStepId}]
supportedLanguages  String[]
defaultLanguage     String
settings            Object     sessionTimeout, maxRetries, errorFallbackMessage
nodes / edges       Mixed      Persisted React Flow canvas state
```

### 7.8 AuditLog

Immutable record of every significant action.

```
userId       ObjectId   Acting user
action       Enum       CREATE|READ|UPDATE|DELETE|LOGIN|LOGOUT|IMPORT|EXPORT|
                        ASSIGN|STATUS_CHANGE|CONFIG_CHANGE|WHATSAPP_MSG|CONSENT_CHANGE
resource     String     Entity name (e.g. 'Grievance')
resourceId   String     Entity ID
companyId    ObjectId
details      Mixed      Action-specific metadata
ipAddress    String
userAgent    String
timestamp    Date
```

### 7.9 Other Collections

| Collection | Purpose |
|---|---|
| `WhatsAppSession` | Citizen conversation state (MongoDB fallback) |
| `CitizenProfile` | Persistent citizen profiles (phone → language preferences, history) |
| `ProcessedWhatsAppMessage` | Deduplication store for incoming messages |
| `CompanyWhatsAppConfig` | Per-company Meta WhatsApp Business API credentials |
| `CompanyWhatsAppTemplate` | Synced WhatsApp message templates per company |
| `CompanyEmailConfig` | Per-company SMTP email configuration |
| `CompanyEmailTemplate` | Per-company email notification templates |
| `CompanyTemplateMapping` | Maps event types to specific WhatsApp templates |
| `WhatsAppTemplate` | Platform-level template registry |
| `WhatsAppTemplateSyncLog` | Audit of template sync operations |
| `AppointmentAvailability` | Officer/dept time slot definitions |
| `Notification` | In-app notification records |
| `Counter` | Atomic ID counters per entity type per company |
| `Module` | Available platform module definitions |
| `Lead` | Business lead capture records |

---

## 8. API Reference Summary

Base URL: `https://connect.pugarch.in/api`

All routes (unless noted) require `Authorization: Bearer <jwt_token>` header.

### Authentication Routes (`/api/auth`)

| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `POST` | `/login` | Log in with phone/email + password | No |
| `POST` | `/sso` | SSO login | No |
| `POST` | `/forgot-password` | Request OTP for password reset | No |
| `POST` | `/reset-password` | Reset password using OTP | No |
| `GET` | `/me` | Get current user profile | Yes |
| `POST` | `/logout` | Invalidate session | Yes |

### Grievance Routes (`/api/grievances`)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | List grievances (paginated, filtered) |
| `POST` | `/` | Create a new grievance |
| `GET` | `/:id` | Get grievance details |
| `PUT` | `/:id` | Update grievance |
| `PATCH` | `/:id/status` | Update status |
| `POST` | `/:id/assign` | Assign to officer |
| `POST` | `/:id/revert` | Revert grievance |
| `GET` | `/:id/timeline` | Get full activity timeline |
| `POST` | `/:id/media` | Upload media attachment |
| `POST` | `/:id/reminder` | Manually trigger SLA reminder |
| `GET` | `/defaulters` | Get defaulter officers list |
| `POST` | `/:id/consent` | Update admin consent |

### Appointment Routes (`/api/appointments`)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | List appointments |
| `POST` | `/` | Create appointment |
| `GET` | `/:id` | Get appointment |
| `PUT` | `/:id` | Update appointment |
| `PATCH` | `/:id/status` | Update status |
| `POST` | `/:id/assign` | Assign officer |

### Assignment Routes (`/api/assignments`)

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/grievance/:id` | Assign grievance |
| `POST` | `/appointment/:id` | Assign appointment |

### User Routes (`/api/users`)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | List users (company scoped) |
| `POST` | `/` | Create user |
| `GET` | `/:id` | Get user details |
| `PUT` | `/:id` | Update user |
| `DELETE` | `/:id` | Deactivate user |

### Department Routes (`/api/departments`)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | List departments |
| `POST` | `/` | Create department |
| `GET` | `/:id` | Get department |
| `PUT` | `/:id` | Update department |
| `DELETE` | `/:id` | Delete department |

### Company Routes (`/api/companies`)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | List companies (SuperAdmin only) |
| `POST` | `/` | Create company (SuperAdmin only) |
| `GET` | `/:id` | Get company details |
| `PUT` | `/:id` | Update company |
| `PATCH` | `/:id/modules` | Update enabled modules |

### Analytics Routes (`/api/analytics`)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/grievances` | Grievance analytics data |
| `GET` | `/appointments` | Appointment analytics data |
| `GET` | `/kpis` | Key performance indicators |

### Dashboard Routes (`/api/dashboard`)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/stats` | Dashboard summary statistics |
| `GET` | `/kpis` | KPI metrics |

### Import/Export Routes

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/import/grievances` | Bulk import from Excel |
| `GET` | `/api/export/grievances` | Export to Excel/CSV |

### WhatsApp Routes (`/api/whatsapp`, `/webhook`)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/webhook` | Meta webhook verification |
| `POST` | `/webhook` | Receive incoming WhatsApp messages |
| `POST` | `/api/whatsapp/send` | Send outbound message |

### Other Routes

| Prefix | Description |
|---|---|
| `/api/chatbot-flows` | Chatbot flow CRUD |
| `/api/whatsapp-config` | Company WhatsApp API config |
| `/api/email-config` | Company email SMTP config |
| `/api/templates` | WhatsApp template management & sync |
| `/api/roles` | Custom role CRUD |
| `/api/modules` | Module definitions |
| `/api/leads` | Lead CRUD |
| `/api/audit` | Audit log queries |
| `/api/notifications` | In-app notifications |
| `/api/availability` | Appointment availability slots |
| `/api/status` | Citizen self-service status lookup |
| `/api/health` | Detailed health check |

---

## 9. Multi-Tenancy Architecture

### Isolation Model

Every data collection in MongoDB has a mandatory `companyId` field. All database queries are scoped to `companyId` to enforce tenant isolation. There is no shared data between companies except:
- Platform-level module definitions (`Module` collection)
- Platform-level WhatsApp template catalog (`WhatsAppTemplate` collection)

### Tenant Identification

- API requests: identified by authenticated user's `companyId`
- WhatsApp webhook: identified by `metadata.phone_number_id` → mapped to `CompanyWhatsAppConfig`
- Each company configures its own WhatsApp Business API credentials

### ID Generation — Per-Company Counters

Atomic counters (`Counter` collection) are maintained per entity type **per company**:
- Grievance IDs restart from `GRV000001` per company
- Appointment IDs restart from `APT000001` per company
- User IDs restart from `USER000001` per company

This prevents ID leakage across tenants (a company cannot infer how many grievances another company has).

### Company Types

| Type | Description |
|---|---|
| `GOVERNMENT` | Government bodies (Collectorate, Forest Dept, etc.) |
| `CUSTOM_ENTERPRISE` | Private enterprise or custom deployment |

### Rate Limiting — Per Tenant

A per-tenant rate limiter (`tenantLimiter`) prevents one tenant from monopolizing server resources. Applied on all `/api` routes.

---

## 10. Security & Compliance

### Authentication & Session Security

| Measure | Detail |
|---|---|
| **JWT Tokens** | Signed with HS256; configurable expiry (default: 7 days) |
| **Password Hashing** | bcrypt with salt rounds = 10 |
| **Account Lockout** | Inactive users are blocked (`isActive: false`) |
| **Company Suspension** | Suspended companies block all user API access |
| **OTP for Password Reset** | OTP delivered via WhatsApp or email |

### API Security

| Measure | Detail |
|---|---|
| **Helmet** | Sets secure HTTP headers (X-Content-Type-Options, HSTS, etc.) |
| **CORS** | Restricted to whitelisted origins in production |
| **Global Rate Limit** | 2000 requests per 15 minutes per IP |
| **Auth Rate Limit** | 50 login attempts per 15 minutes per IP |
| **Webhook Signature Verification** | HMAC-SHA256 verification of Meta webhook payloads |
| **Input Validation** | Zod/Joi schemas on all API inputs |
| **SQL/NoSQL Injection Prevention** | Mongoose ODM parameterised queries |
| **Sanitization** | Text inputs sanitized before storage |

### Data Security

| Measure | Detail |
|---|---|
| **Password field** | Excluded from all queries by default (`select: false`) |
| **Tenant Isolation** | All queries mandatorily scoped to `companyId` |
| **Media Storage** | Citizen media stored in private GCS buckets |
| **Audit Logging** | All destructive actions logged with IP, user agent, timestamp |
| **Database Safety** | `databaseSafety` middleware logs context for all destructive DB operations |

### Compliance

- **WhatsApp Business Policy:** Only template messages sent outside 24-hour conversation windows (Meta's 24-hour messaging policy enforced in `isWithin24Hours` check)
- **Admin Consent:** `admin_consent` field on grievances for GDPR/data processing consent tracking
- **Data Localisation:** GCS bucket region configurable (e.g., `asia-south1` for India)

---

## 11. Integrations

### 11.1 Meta WhatsApp Business API

- **API Version:** Graph API v18.0
- **Endpoint:** `https://graph.facebook.com/v18.0/{phoneNumberId}/messages`
- **Authentication:** Bearer token (per company, stored in `CompanyWhatsAppConfig`)
- **Webhook Events:** `messages`, `statuses`
- **Template Sync:** Automated cron syncs approved templates from Meta to local DB every hour
- **Message Types Supported:** Text, Template, Interactive Buttons, Interactive List, Image, Document, Video, Location

### 11.2 Google Cloud Storage (GCS)

- **Purpose:** Store citizen-uploaded media (images, documents, videos) and admin-uploaded evidence
- **Bucket:** Configurable via `GCS_BUCKET_NAME` env var
- **Authentication:** Application Default Credentials (ADC) or service account JSON
- **Access:** URLs stored in grievance/appointment `media` array

### 11.3 Email (SMTP / Nodemailer)

- **Configuration:** Per-company SMTP settings stored in `CompanyEmailConfig`
- **Templates:** HTML email templates stored in `CompanyEmailTemplate`
- **Fallback:** Environment-level SMTP config for system notifications
- **Events:** All notification events listed in Section 4.6

### 11.4 Redis

- **Purpose:** WhatsApp session storage, per-tenant rate limiting, flow caching
- **Client:** ioredis
- **Fallback:** In-memory Map (rate limits) + MongoDB (sessions) when Redis is unavailable
- **Configuration:** `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` environment variables

### 11.5 MongoDB Atlas

- **ODM:** Mongoose 8.x
- **Connection Pooling:** Managed by Mongoose
- **Indexes:** Compound indexes on all frequently queried field combinations
- **Geospatial:** 2dsphere index on `Grievance.location.coordinates`

---

## 12. Deployment & Infrastructure

### 12.1 Container Architecture

The project uses a **monorepo** structure with a single unified Dockerfile:

```
Root Dockerfile
├── Stage 1: Build Next.js (output: standalone)
├── Stage 2: Build Express TypeScript (tsc → dist/)
└── Stage 3: Production Image
    ├── Node.js 20 Alpine base
    ├── Nginx (reverse proxy on port 8080)
    ├── Supervisord (process manager)
    ├── Next.js standalone (port 3000)
    └── Express API (port 5001)
```

### 12.2 Startup Sequence

1. Supervisord starts both Next.js and Express simultaneously
2. `wait-and-start-nginx.sh` polls Express health (`5001/health`) and Next.js (`3000`)
3. Only after both services respond does Nginx open port 8080 for traffic
4. Express performs async initialization (GCS, MongoDB, Redis, counters, crons)
5. SLA Escalation Cron starts after 30-second delay
6. WhatsApp Template Sync Cron starts

### 12.3 Cloud Run Configuration

| Parameter | Recommended Value |
|---|---|
| **Memory** | 2 GiB |
| **CPU** | 2 vCPU |
| **Min Instances** | 1 (keep warm for WhatsApp webhooks) |
| **Max Instances** | 10 |
| **Request Timeout** | 300 seconds |
| **Port** | 8080 |
| **Region** | asia-southeast1 (Singapore) or asia-south1 (Mumbai) |

### 12.4 CI/CD

- **Build System:** Google Cloud Build (`cloudbuild.yaml`)
- **Trigger:** Push to `main` branch
- **Pipeline:** Build Docker image → Push to Artifact Registry → Deploy to Cloud Run
- **Image Tagging:** Immutable SHA tags + `latest`

### 12.5 Docker Compose (Local Development)

```yaml
Services:
  - portal (Next.js + Express, port 8080)
  - mongodb (port 27017)
  - redis (port 6379)
```

---

## 13. Configuration Reference

### 13.1 Required Environment Variables

| Variable | Description |
|---|---|
| `NODE_ENV` | `production` or `development` |
| `MONGODB_URI` | MongoDB connection URI |
| `JWT_SECRET` | JWT signing secret (min 32 chars) |
| `GCP_PROJECT_ID` | GCP Project ID |
| `GCS_BUCKET_NAME` | GCS bucket for media storage |

### 13.2 Optional Environment Variables

| Variable | Description | Default |
|---|---|---|
| `PORT` | Server port | `5001` (overridden by Cloud Run) |
| `FRONTEND_URL` | Allowed CORS origins | `https://connect.pugarch.in` |
| `JWT_EXPIRES_IN` | JWT token lifespan | `7d` |
| `REDIS_HOST` | Redis hostname | — (in-memory fallback) |
| `REDIS_PORT` | Redis port | `6379` |
| `REDIS_PASSWORD` | Redis auth password | — |
| `GCP_SERVICE_ACCOUNT_JSON` | Service account credentials | — (ADC used on GCP) |
| `ALLOW_EMPTY_USERS_ON_STARTUP` | Allow fresh DB start | `false` |

### 13.3 WhatsApp API Limits (Enforced in Code)

| Resource | Limit |
|---|---|
| Interactive Buttons | Max 3 per message |
| Button Title | Max 20 characters |
| List Sections | Max 10 rows per section |
| Row Title | Max 24 characters |
| Message Body | Max 4096 characters |
| Rate Limit | 30 messages/min, 500/hr, 5000/day per company |
| Recipients per minute | Max 10 unique recipients |

### 13.4 Pagination Defaults

| Parameter | Value |
|---|---|
| Default Page | 1 |
| Default Page Size | 20 |
| Maximum Page Size | 100 |

### 13.5 File Upload Limits

| Parameter | Value |
|---|---|
| Max File Size | 10 MB |
| Allowed Image Types | JPEG, PNG, JPG, WebP |
| Allowed Document Types | PDF, DOC, DOCX |
| Allowed Video Types | Via WhatsApp only |

---

## 14. Glossary

| Term | Definition |
|---|---|
| **Chatbot Flow** | A versioned, visual conversation script defining how the WhatsApp bot interacts with citizens |
| **Company** | A tenant on the platform; can be a government body or enterprise |
| **Citizen** | End user interacting via WhatsApp; not a registered platform user |
| **Company Admin** | Highest-level user within a company; manages all resources |
| **Defaulter** | An officer who has not resolved an overdue grievance after multiple automated reminders |
| **Dynamic Flow Engine** | The backend service that processes incoming WhatsApp messages and drives chatbot conversations |
| **GCS** | Google Cloud Storage — used for media file uploads |
| **Grievance** | A formal citizen complaint registered through the platform |
| **Meta Graph API** | Facebook/Meta's API for WhatsApp Business messaging |
| **SLA** | Service Level Agreement — the maximum time allowed to resolve a grievance |
| **SLA Breach** | A grievance that has exceeded its SLA deadline without resolution |
| **SuperAdmin** | Platform-level administrator managing all companies |
| **Tenant** | Synonym for Company; an isolated organisation on the platform |
| **Webhook** | An HTTP callback sent by Meta's servers when a WhatsApp message is received |
| **WhatsApp Template** | Pre-approved message format required by Meta for outbound notifications |
| **RBAC** | Role-Based Access Control — permission model governing who can do what |
| **In-App Notification** | Notification visible in the dashboard bell icon |
| **Flow Step** | A single node in a chatbot flow (e.g., a question, a button menu) |
| **Session** | Temporary per-citizen conversation state stored in Redis |
| **SLA Escalation Cron** | Scheduled background job that checks SLA breach and fires reminders |
| **IST** | Indian Standard Time — all timestamps stored in UTC, converted to IST for display |

---

*Document generated from source code analysis of PugArch Connect Portal v5.0*  
*Repository: connect.pugarch*  
*All rights reserved — PugArch 2026*
