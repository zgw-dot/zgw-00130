const jwt = require('jsonwebtoken');
const db = require('./db');

const JWT_SECRET = 'outpatient-waitlist-secret-key-2024';

const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未提供认证令牌' });
  }
  try {
    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(decoded.userId);
    if (!user) {
      return res.status(401).json({ error: '用户不存在' });
    }
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: '无效或过期的令牌' });
  }
};

const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: '需要管理员权限' });
  }
  next();
};

const requireConfigPermission = (req, res, next) => {
  const clerkCanModify = db.prepare("SELECT value FROM config WHERE key = 'clerk_can_modify_global_config'").get();
  const isAllowed = req.user.role === 'admin' || (clerkCanModify && clerkCanModify.value === 'true');
  if (!isAllowed) {
    return res.status(403).json({ error: '您没有修改全局配置的权限' });
  }
  next();
};

const getClientIp = (req) => {
  return req.headers['x-forwarded-for'] || req.ip || req.connection.remoteAddress || 'unknown';
};

module.exports = {
  JWT_SECRET,
  authMiddleware,
  requireAdmin,
  requireConfigPermission,
  getClientIp
};
