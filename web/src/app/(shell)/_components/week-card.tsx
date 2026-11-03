/** A study day's calendar date, at midnight UTC, and the distinct cards answered on it. */
type WeekDay = { date: number; cards: number };

/** The bars' height at the week's most cards, in pixels: the phone's. */
const barHeight = 48;

/**
 * 홈's week card under the hero, as the phone draws it (ADR 0165): "n일 연속", the count in the
 * accent, with the last seven study days' cards at its right, over a bar a day, each under its
 * count and over its weekday, today's last and in the accent. A day with no card is a dashed bar.
 */
export function WeekCard({ streak, week }: { streak: number; week: WeekDay[] }) {
  const most = Math.max(0, ...week.map((day) => day.cards));
  const total = week.reduce((sum, day) => sum + day.cards, 0);
  const weekday = new Intl.DateTimeFormat("ko-KR", { weekday: "short", timeZone: "UTC" });
  const name = (index: number, date: number) =>
    index === week.length - 1 ? "오늘" : weekday.format(date);
  return (
    <section
      aria-labelledby="week-title"
      className="flex flex-col gap-2 rounded-card bg-surface px-5 py-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-2">
        <h2 id="week-title" className="text-title">
          <span className="text-accent">{streak}</span>일 연속
        </h2>
        <p className="text-caption text-ink-2">지난 7일 {total}장</p>
      </div>
      <div
        role="img"
        aria-label={week
          .map((day, index) => `${name(index, day.date)} ${String(day.cards)}장`)
          .join(", ")}
        className="flex flex-col gap-1"
      >
        <div aria-hidden className="grid grid-cols-7 items-end gap-2">
          {week.map((day, index) => {
            const today = index === week.length - 1;
            return (
              <span key={day.date} className="flex flex-col items-center gap-1">
                <span
                  className={`text-caption tabular-nums ${today ? "text-accent" : "text-ink-2"}`}
                >
                  {day.cards}
                </span>
                <span
                  data-bar={day.cards === 0 ? "dashed" : "drawn"}
                  className={`w-full rounded-t-lg rounded-b-sm ${
                    day.cards === 0
                      ? `h-4 border-2 border-dashed ${today ? "border-accent" : "border-edge"}`
                      : today
                        ? "bg-accent"
                        : "bg-heat-1"
                  }`}
                  style={
                    day.cards === 0
                      ? undefined
                      : { height: `${String(Math.max(8, (barHeight * day.cards) / most))}px` }
                  }
                />
              </span>
            );
          })}
        </div>
        <div aria-hidden className="grid grid-cols-7 gap-2 text-center">
          {week.map((day, index) => (
            <span
              key={day.date}
              className={`text-caption ${index === week.length - 1 ? "text-accent" : "text-ink-2"}`}
            >
              {name(index, day.date)}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
