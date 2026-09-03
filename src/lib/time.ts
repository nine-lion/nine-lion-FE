export function formatMinutesKo(minutes: number): string {
  const rounded = Math.max(0, Math.round(minutes));
  const hours = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  if (hours <= 0) return `${remainder}분`;
  if (remainder === 0) return `${hours}시간`;
  return `${hours}시간 ${remainder}분`;
}

export function formatClockKo(minutesFromMidnight: number): string {
  const rounded = Math.round(minutesFromMidnight);
  const hours = Math.floor(rounded / 60) % 24;
  const minutes = ((rounded % 60) + 60) % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}
