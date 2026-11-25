# Documentation

This folder contains the official technical and functional documentation for the **PugArch Connect Portal**.

## Files

| File | Format | Description |
|---|---|---|
| [`PugArch_Connect_Portal_Documentation.pdf`](./PugArch_Connect_Portal_Documentation.pdf) | PDF | Shareable PDF — preferred format for distribution |
| [`PugArch_Connect_Portal_Documentation.html`](./PugArch_Connect_Portal_Documentation.html) | HTML | Styled HTML — open in browser and use Print → Save as PDF for best quality |
| [`PugArch_Connect_Portal_Documentation.md`](./PugArch_Connect_Portal_Documentation.md) | Markdown | Source markdown — readable directly on GitHub/GitLab |

## Contents Overview

The documentation covers the full technical and functional specification of the portal:

1. **Executive Summary** — Platform overview and value propositions
2. **System Architecture** — Architecture diagram, request routing, deployment topology
3. **Technology Stack** — All backend and frontend libraries with versions
4. **Application Modules & Features** — All 15 configurable modules in detail:
   - Grievance Management
   - Appointment Management
   - WhatsApp Chatbot & Dynamic Flow Engine
   - Lead Capture
   - Analytics & Reporting
   - Notifications (WhatsApp + Email + In-App)
5. **User Roles & Access Control (RBAC)** — Role hierarchy, permission model, scopes
6. **Business Logic & Workflows** — Step-by-step flows for:
   - Grievance lifecycle
   - 3-Level SLA Escalation Engine (Officer → Department Head → District Collector)
   - Appointment lifecycle
   - WhatsApp Dynamic Flow Engine
7. **Data Models** — All 22+ MongoDB collections with field-level documentation
8. **API Reference Summary** — All 50+ REST endpoints across 18 route groups
9. **Multi-Tenancy Architecture** — Tenant isolation, per-company ID counters
10. **Security & Compliance** — JWT, bcrypt, CORS, rate limiting, webhook verification
11. **Integrations** — Meta WhatsApp Business API, GCS, SMTP, Redis, MongoDB Atlas
12. **Deployment & Infrastructure** — GCP Cloud Run, Docker, Supervisord, CI/CD
13. **Configuration Reference** — All environment variables, limits, defaults
14. **Glossary** — 20+ platform-specific terms defined

---

> **Version:** v5.0 | **Date:** November 2026 | **Platform:** connect.pugarch.in
