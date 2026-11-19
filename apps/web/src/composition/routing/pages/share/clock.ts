/** An hour of the day as `14:00`. */
export const clock = (hour: number): string => `${String(hour).padStart(2, "0")}:00`;
