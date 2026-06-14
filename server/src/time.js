const db = require('./db');

const getTimeOverride = () => {
  return db.prepare('SELECT * FROM time_overrides WHERE id = 1').get();
};

const getCurrentTime = () => {
  const override = getTimeOverride();
  if (override.mode === 'manual' && override.current_time) {
    return new Date(override.current_time);
  }
  const now = new Date();
  if (override.mode === 'manual' && override.speed_multiplier && override.speed_multiplier !== 1.0) {
    const baseTime = override.current_time ? new Date(override.current_time) : now;
    const elapsed = (now - baseTime) * (override.speed_multiplier - 1);
    return new Date(now.getTime() + elapsed);
  }
  return now;
};

const formatDateTime = (date) => {
  const pad = (n) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

const addSeconds = (date, seconds) => {
  return new Date(date.getTime() + seconds * 1000);
};

const diffSeconds = (a, b) => {
  return Math.floor((a - b) / 1000);
};

const setManualTime = (isoString) => {
  db.prepare(`UPDATE time_overrides SET mode = 'manual', current_time = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1`).run(isoString);
};

const setSpeedMultiplier = (multiplier) => {
  db.prepare(`UPDATE time_overrides SET speed_multiplier = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1`).run(multiplier);
};

const resetToRealTime = () => {
  db.prepare(`UPDATE time_overrides SET mode = 'real', current_time = NULL, speed_multiplier = 1.0, updated_at = CURRENT_TIMESTAMP WHERE id = 1`).run();
};

const advanceTime = (seconds) => {
  const current = getCurrentTime();
  const newTime = addSeconds(current, seconds);
  setManualTime(newTime.toISOString());
  return newTime;
};

module.exports = {
  getTimeOverride,
  getCurrentTime,
  formatDateTime,
  addSeconds,
  diffSeconds,
  setManualTime,
  setSpeedMultiplier,
  resetToRealTime,
  advanceTime
};
