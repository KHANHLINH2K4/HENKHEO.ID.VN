let ioInstance = null;

export function setIO(io) {
  ioInstance = io;
}

export function emitToUser(userId, event = "notification:new", payload = {}) {
  if (!ioInstance || !userId) return;
  ioInstance.to(`user:${Number(userId)}`).emit(event, payload);
}

export function emitToRole(role, event = "notification:new", payload = {}) {
  if (!ioInstance || !role) return;
  ioInstance.to(`role:${String(role).toUpperCase()}`).emit(event, payload);
}
