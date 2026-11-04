import { FittedLine } from "@/design/fitted-line";

/** A study day's calendar date, at midnight UTC, and the distinct cards answered on it. */
type WeekDay = { date: number; cards: number };

/**
 * 홈's streak on the ground, as the phone draws it: "n일 연속", the count in the accent, over a dot
 * a day for the last seven study days, today's last. A day with cards is filled in the accent, a
 * day without one outlined, and today outlined in `today-mark`, filled once the day is [done]. Each
 * dot is over its weekday, on one line shrunk to its column where it is wider, today's "오늘" in
 * `today-text`; the dots are read as one image naming each day and its cards.
 */
export function StreakDays({
  streak,
  week,
  done,
}: {
  streak: number;
  week: WeekDay[];
  done: boolean;
}) {
  const weekday = new Intl.DateTimeFormat("ko-KR", { weekday: "short", timeZone: "UTC" });
  const last = week.length - 1;
  const name = (index: number, date: number) => (index === last ? "오늘" : weekday.format(date));
  return (
    <section aria-labelledby="streak-title" className="flex w-full flex-col items-center gap-2">
      <h2 id="streak-title" className="text-title">
        <span className="text-accent">{streak}</span>일 연속
      </h2>
      <div
        role="img"
        aria-label={week
          .map((day, index) => `${name(index, day.date)} ${String(day.cards)}장`)
          .join(", ")}
        className="grid w-full grid-cols-7 items-start gap-2"
      >
        {week.map((day, index) => {
          const today = index === last;
          return (
            <span key={day.date} aria-hidden className="flex flex-col items-center gap-1">
              <span
                data-day={
                  today ? (done ? "today-done" : "today") : day.cards > 0 ? "studied" : "none"
                }
                className={`aspect-square w-full max-w-7 rounded-full ${
                  today
                    ? `border-2 border-today-mark ${done ? "bg-today-mark" : ""}`
                    : day.cards > 0
                      ? "bg-accent"
                      : "border-2 border-outline"
                }`}
              />
              <FittedLine
                className={`text-center ${today ? "text-section text-today-text" : "text-micro text-ink-2"}`}
              >
                {name(index, day.date)}
              </FittedLine>
            </span>
          );
        })}
      </div>
    </section>
  );
}
