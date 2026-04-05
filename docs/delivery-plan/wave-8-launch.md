# Wave 8: Production Hardening & Launch

**Status:** `not_started`
**Estimated effort:** 2 weeks
**Goal:** Prepare for production launch — performance, security, monitoring, and operational readiness.

## Why This Wave Matters

Everything built in Waves 1-7 needs to be hardened for real-world usage. This wave ensures Teranga can handle actual events in Senegal with real users, real money, and real connectivity challenges.

---

## Tasks

### Performance & Scalability

- [ ] Load testing with realistic scenarios (100+ concurrent registrations, 50+ scanners)
- [ ] Firestore query optimization (review all queries, add missing indexes)
- [ ] Cloud Run autoscaling configuration (min instances, max instances, concurrency)
- [ ] CDN configuration for static assets (event images, badge PDFs)
- [ ] Database read optimization (denormalization audit, composite index review)
- [ ] API response time benchmarks (< 200ms p95 for critical paths)

### Security Hardening

- [ ] Penetration testing (or self-audit with OWASP checklist)
- [ ] API rate limiting fine-tuning (per endpoint, per user tier)
- [ ] Firestore security rules comprehensive test suite
- [ ] Input sanitization audit (XSS, injection vectors)
- [ ] Secret rotation procedure documented
- [ ] CORS configuration review for production domains
- [ ] CSP headers for web backoffice

### Monitoring & Observability

- [ ] Cloud Logging structured log format
- [ ] Error tracking (Sentry or Cloud Error Reporting)
- [ ] Uptime monitoring for API and web
- [ ] Alert rules (5xx rate, latency p95, error budget)
- [ ] Dashboard: request rate, latency, error rate, active users
- [ ] Audit log viewer for super admins

### Operational Readiness

- [ ] Production environment setup (Firebase project, Cloud Run service, domains)
- [ ] DNS and SSL configuration
- [ ] Backup strategy for Firestore (scheduled exports to GCS)
- [ ] Disaster recovery procedure documented
- [ ] On-call runbook for common issues
- [ ] Data retention policy (GDPR-like compliance for user data)

### Mobile Release

- [ ] App Store submission preparation (screenshots, descriptions in French)
- [ ] Google Play Store submission
- [ ] App signing and keystore management
- [ ] Deep linking configuration (event URLs → app)
- [ ] Crash reporting (Firebase Crashlytics)
- [ ] App version management and forced update mechanism

### Web Release

- [ ] Custom domain setup for backoffice
- [ ] SEO meta tags for public event pages
- [ ] Open Graph tags for social sharing
- [ ] PWA manifest and offline shell
- [ ] Cookie consent (if needed for Senegalese regulations)

### Launch Preparation

- [ ] Seed production data (test organization, test events)
- [ ] Beta tester program (invite 5-10 organizers)
- [ ] User documentation (organizer guide in French)
- [ ] Support channel setup (WhatsApp group or Intercom)
- [ ] Launch metrics definition (DAU, events created, registrations, check-in rate)

---

## Exit Criteria

- [ ] Load test passes: 100 concurrent registrations, 50 concurrent check-ins
- [ ] API p95 latency < 200ms for registration and check-in endpoints
- [ ] Zero critical security findings in audit
- [ ] Monitoring dashboard active with alerting
- [ ] Mobile apps submitted to app stores
- [ ] Web backoffice accessible on production domain
- [ ] At least 3 beta organizers have created real events
- [ ] On-call runbook reviewed by team

## Dependencies

- All previous waves completed
- Production Firebase project provisioned
- Domain names purchased
- App store developer accounts active
- Payment provider production API keys

## Deploys After This Wave

- **Production launch** — all services deployed to production environment
- Mobile apps live on app stores
- Web backoffice live on production domain

## Technical Notes

- **Cloud Run min instances**: Set to 1 for production to avoid cold starts on the API
- **Firestore exports**: Schedule daily exports to a GCS bucket for backup
- **Forced update**: Use Firebase Remote Config to gate minimum app version
- **Beta program**: Use Firebase App Distribution for pre-store beta testing
