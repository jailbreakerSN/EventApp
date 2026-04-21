# Notifications & Broadcasts API

> **Status: shipped**

---

## Send broadcast

```
POST /v1/notifications/send
```

**Auth:** Required  
**Permission:** `notification:send` + org membership  
**Plan limit:** `smsNotifications` required for SMS channel (Pro+)

**Request body:**

```typescript
{
  eventId: string;
  subject: string;
  body: string;
  channels: ('push' | 'email' | 'sms' | 'in_app')[];
  recipients: 'all' | 'checked_in' | 'not_checked_in';
  scheduledAt?: string;            // ISO 8601 — omit to send immediately
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "broadcastId": "bc_xyz",
    "status": "sending",           // or "scheduled" if scheduledAt is set
    "recipientCount": 87
  }
}
```

---

## Get my notifications

```
GET /v1/notifications/me
```

**Auth:** Required  
**Permission:** Any authenticated user

**Query parameters:** `page`, `limit`, `isRead` (`true` | `false`)

---

## Mark notification as read

```
PATCH /v1/notifications/:notificationId/read
```

**Auth:** Required  
**Permission:** Owner of the notification

---

## Mark all as read

```
POST /v1/notifications/me/read-all
```

**Auth:** Required

---

## Notification types

| Type | Triggered by |
|---|---|
| `registration_confirmed` | Registration confirmed |
| `badge_ready` | Badge PDF generated |
| `event_reminder` | Cloud Scheduler (24h before event) |
| `session_reminder` | Cloud Scheduler (1h before bookmarked session) |
| `check_in_success` | Successful QR scan |
| `new_message` | Incoming 1:1 message |
| `waitlist_promoted` | Moved from waitlist to confirmed |
| `broadcast` | Organizer broadcast |
| `registration_approved` | Organizer manually approves registration |

---

## Broadcast channels

| Channel | Provider | Plan requirement |
|---|---|---|
| `in_app` | Firestore | All plans |
| `push` | Firebase Cloud Messaging | All plans |
| `email` | Resend | All plans |
| `sms` | Africa's Talking (+221 focus) | Pro+ |
