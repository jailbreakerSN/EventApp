# Feed API

> **Status: shipped**

Base path: `/v1/events/:eventId/feed`

---

## List feed posts

```
GET /v1/events/:eventId/feed/posts
```

**Auth:** Required  
**Permission:** `feed:read` + event access (registered participants or org member)

**Query parameters:** `page`, `limit`, `type` (`announcement` | `update` | `general`)

---

## Create post

```
POST /v1/events/:eventId/feed/posts
```

**Auth:** Required  
**Permission:** `feed:create_post`

**Request body:**

```typescript
{
  content: string;                 // max 2000 chars
  type: 'announcement' | 'update' | 'general';
  imageUrl?: string;
}
```

---

## Delete post

```
DELETE /v1/events/:eventId/feed/posts/:postId
```

**Auth:** Required  
**Permission:** `feed:delete_post` (own post) or `feed:manage_content` (organizer)

Soft-delete — sets `deletedAt` timestamp.

---

## Pin post

```
POST /v1/events/:eventId/feed/posts/:postId/pin
```

**Auth:** Required  
**Permission:** `feed:manage_content` (organizer/co_organizer)

Pinned posts appear at the top of the feed.

---

## Add comment

```
POST /v1/events/:eventId/feed/posts/:postId/comments
```

**Auth:** Required  
**Permission:** `feed:create_post` (any participant)

**Request body:**
```typescript
{ content: string }               // max 500 chars
```

---

## Moderate comment

```
DELETE /v1/events/:eventId/feed/posts/:postId/comments/:commentId
```

**Auth:** Required  
**Permission:** `feed:moderate` (organizer) or own comment
