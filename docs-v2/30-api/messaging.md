---
title: Messaging API
status: shipped
last_updated: 2026-04-25
---

# Messaging API

> **Status: shipped** — 1:1 participant messaging.

Base path: `/v1/conversations`

---

## List conversations

```
GET /v1/conversations
```

**Auth:** Required  
**Permission:** `messaging:read` (own conversations)

Returns all conversations for the authenticated user, ordered by `lastMessageAt` descending.

---

## Start or get conversation

```
POST /v1/conversations
```

**Auth:** Required  
**Permission:** `messaging:send`

Creates a new 1:1 conversation or returns the existing one between the two participants.

**Request body:**
```typescript
{
  participantId: string;           // uid of the other user
  eventId?: string;                // optional — link conversation to an event
}
```

---

## Get messages

```
GET /v1/conversations/:conversationId/messages
```

**Auth:** Required  
**Permission:** `messaging:read` (must be a participant in the conversation)

**Query parameters:** `page`, `limit` (most recent first)

---

## Send message

```
POST /v1/conversations/:conversationId/messages
```

**Auth:** Required  
**Permission:** `messaging:send` (must be a participant in the conversation)

**Request body:**
```typescript
{
  content: string;                 // max 1000 chars
}
```

---

## Mark conversation as read

```
PATCH /v1/conversations/:conversationId/read
```

**Auth:** Required

Resets the unread count for the authenticated user in this conversation.
