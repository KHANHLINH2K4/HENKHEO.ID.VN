import { test } from "node:test";
import assert from "node:assert/strict";
import { createLoginGuard } from "../loginGuard.js";

test("Khóa tạm cặp IP+tên sau N lần sai, đăng nhập đúng thì xóa bộ đếm", () => {
  let t = 0;
  const g = createLoginGuard({ perIpLimit: 3, perUserLimit: 100, windowMs: 60_000, now: () => t });
  for (let i = 0; i < 3; i++) g.recordFailure("1.1.1.1", "An");
  assert.ok(g.retryAfterSeconds("1.1.1.1", "an") > 0, "tên không phân biệt hoa/thường");
  assert.equal(g.retryAfterSeconds("2.2.2.2", "an"), 0, "IP khác không bị khóa");
  t = 61_000;
  assert.equal(g.retryAfterSeconds("1.1.1.1", "an"), 0, "hết cửa sổ thì mở khóa");
  g.recordFailure("1.1.1.1", "an"); g.recordSuccess("1.1.1.1", "an");
  assert.equal(g.retryAfterSeconds("1.1.1.1", "an"), 0);
});

test("Nhiều IP cùng dò một tài khoản bị khóa theo tên", () => {
  const g = createLoginGuard({ perIpLimit: 100, perUserLimit: 5, windowMs: 60_000, now: () => 0 });
  for (let i = 0; i < 5; i++) g.recordFailure(`10.0.0.${i}`, "admin");
  assert.ok(g.retryAfterSeconds("10.0.0.99", "admin") > 0);
  assert.equal(g.retryAfterSeconds("10.0.0.99", "khac"), 0);
});
