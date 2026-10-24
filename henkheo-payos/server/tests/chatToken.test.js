import { test } from "node:test";
import assert from "node:assert/strict";
process.env.JWT_SECRET = "test-secret-for-chat";
process.env.DB_CONNECT_TIMEOUT = "500";
const { conversationToken, validConversationToken } = await import("../routes/chat.js");

test("Token hội thoại ẩn danh: đúng id mới hợp lệ, không đoán được từ id khác", () => {
  const t1 = conversationToken(1);
  assert.equal(validConversationToken(1, t1), true);
  assert.equal(validConversationToken(2, t1), false);
  assert.equal(validConversationToken(1, ""), false);
  assert.equal(validConversationToken(1, undefined), false);
  assert.equal(validConversationToken(1, "x".repeat(32)), false);
  assert.notEqual(conversationToken(1), conversationToken(2));
});
