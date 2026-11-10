"use client";

import { useActionState } from "react";

import { setTriageSettings, type TriageSettingsState } from "../set-triage-settings";
import { button, field, formInput, formLine, group } from "./admin-section";

const input = `${field} ${formInput} w-28`;

/**
 * The triage's confidence threshold, daily spend cap, notes judged a day, re-check sample and
 * reports a person may make a day, starting from the values in force. The mode is not here: it has
 * its own switch.
 */
export function TriageSettingsForm({
  start,
}: {
  start: {
    actThreshold: number;
    dailyCapUsd: number;
    dailyNotes: number;
    samplePercent: number;
    reporterDailyCap: number;
  };
}) {
  const [state, action, pending] = useActionState<TriageSettingsState, FormData>(
    setTriageSettings,
    { message: null },
  );
  return (
    <form action={action} aria-label="신고 AI 기준과 한도" className="flex flex-col gap-2">
      <div className={group}>
        <label className={formLine}>
          <span className="shrink-0 text-body">처리할 확신 기준</span>
          <input
            type="number"
            name="act_threshold"
            min={0.5}
            max={1}
            step={0.01}
            required
            defaultValue={start.actThreshold}
            className={input}
          />
        </label>
        <label className={formLine}>
          <span className="shrink-0 text-body">하루 비용 한도 (달러)</span>
          <input
            type="number"
            name="daily_cap_usd"
            min={0}
            max={1000}
            step={0.01}
            required
            defaultValue={start.dailyCapUsd}
            className={input}
          />
        </label>
        <label className={formLine}>
          <span className="shrink-0 text-body">하루 판단 수</span>
          <input
            type="number"
            name="daily_notes"
            min={0}
            max={10000}
            step={1}
            required
            defaultValue={start.dailyNotes}
            className={input}
          />
        </label>
        <label className={formLine}>
          <span className="shrink-0 text-body">다시 확인 비율 (%)</span>
          <input
            type="number"
            name="sample_percent"
            min={0}
            max={100}
            step={1}
            required
            defaultValue={start.samplePercent}
            className={input}
          />
        </label>
        <label className={formLine}>
          <span className="shrink-0 text-body">한 사람의 하루 신고 수</span>
          <input
            type="number"
            name="reporter_daily_cap"
            min={1}
            max={1000}
            step={1}
            required
            defaultValue={start.reporterDailyCap}
            className={input}
          />
        </label>
      </div>
      <button type="submit" disabled={pending} className={button.secondary}>
        저장
      </button>
      <p role="status" className="text-caption text-muted empty:hidden">
        {state.message}
      </p>
    </form>
  );
}
