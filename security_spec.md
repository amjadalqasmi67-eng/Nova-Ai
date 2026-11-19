# Security Specification — Nova AI

## 1. Data Invariants
1. **Strict Ownership**: Every document under `/users/{userId}` and its subcollections (`conversations`, `messages`) is accessible ONLY when `request.auth != null`, `request.auth.token.email_verified == true`, and `request.auth.uid == userId`.
2. **Master Gate Relational Sync**: Access to `/users/{userId}/conversations/{conversationId}/messages/{messageId}` verifies via `get()` that the parent conversation exists and belongs to `request.auth.uid`, and that `incoming().conversationId == conversationId`.
3. **Contact Messages & AI Triage Isolation**: `/contactMessages/{messageId}` can be created by any verified signed-in user where `incoming().userId == request.auth.uid`, `incoming().senderEmail == request.auth.token.email`, `incoming().status == 'new'`, and `incoming().triageLevel == 'pending'`. The sender may transition `triageLevel` once from `'pending'` to `'simple'` or `'urgent'` with `aiReply`, `aiSummary`, and `triagedAt == request.time`, without modifying `status` or original message content. Only the owner admin (`amjad.alqasmi67@gmail.com`) can list all messages (including urgent escalations) and update `status` (`'new' | 'reviewed'`).
4. **Immutable Ownership & Timestamps**: `uid` / `userId` and `createdAt` cannot be modified after creation. `createdAt` must equal `request.time` on creation, and `updatedAt` must equal `request.time` on creation and update.
5. **No Shadow Fields**: Every create checks `keys().hasAll(...)` and `keys().hasOnly(...)`, and every update uses `affectedKeys().hasOnly(...)` paired with the entity validator `isValid[Entity](incoming())`.
6. **Path ID & String Size Guard**: All document IDs are validated with `isValidId()` (`<= 128` chars, `^[a-zA-Z0-9_-]+$`), and every string field enforces explicit `.size()` bounds.
7. **Admin Analytics Isolation**: Only `isAdmin()` (`amjad.alqasmi67@gmail.com` with `email_verified == true`) can `list` `/users` for new-user growth charts and `list` `/visitLogs` for daily visit charts. Regular users can only create `/visitLogs/{visitId}` for their own `uid` with `createdAt == request.time`, valid `dateKey` (`YYYY-MM-DD`), and `deviceType` in `['mobile', 'tablet', 'desktop']`.

## 2. Adversarial Test Payloads ("Dirty Dozen")
1. Cross-user read on `/users/{otherUid}` -> `PERMISSION_DENIED`
2. Non-admin `list` on `/users` or `/visitLogs` -> `PERMISSION_DENIED`
3. Unverified email write on `/users/{uid}` or `/visitLogs/{visitId}` -> `PERMISSION_DENIED`
4. Shadow field `isAdmin: true` on `/users/{uid}` create -> `PERMISSION_DENIED`
5. Shadow field `role: "admin"` on `/users/{uid}` update -> `PERMISSION_DENIED`
6. Spoofed `userId` on `/users/{uid}/conversations/{cid}` or `/visitLogs/{visitId}` create -> `PERMISSION_DENIED`
7. Client-forged `createdAt` timestamp != `request.time` -> `PERMISSION_DENIED`
8. Invalid `dateKey` format or invalid `deviceType` on `/visitLogs/{visitId}` -> `PERMISSION_DENIED`
9. Oversized `title` (> 120 chars) on conversation update -> `PERMISSION_DENIED`
10. Orphaned message creation referencing non-existent parent conversation -> `PERMISSION_DENIED`
11. Spoofed `userId`, `senderEmail`, `status: 'reviewed'`, or pre-set `triageLevel: 'urgent'` on `/contactMessages/{id}` create by non-admin -> `PERMISSION_DENIED`
12. Cross-user read/list or `status` update on `/contactMessages/{id}` by a non-admin user -> `PERMISSION_DENIED`

