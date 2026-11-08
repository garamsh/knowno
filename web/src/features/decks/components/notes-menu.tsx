"use client";

import { useState } from "react";

import { raised, RowMenu } from "@/design/row-menu";

import { AuthoringSheets, type AuthoringScreen } from "./authoring-sheets";

/**
 * The 노트 page's ⋯, "노트 메뉴", as the phone's 노트 tab has it (#722): "직접 추가", which opens
 * 새 노트 to make a note by hand, where 말랑이 is the way to make one by default.
 */
export function NotesMenu() {
  const [screen, setScreen] = useState<AuthoringScreen | null>(null);
  return (
    <>
      <RowMenu
        label="노트 메뉴"
        trigger={raised}
        items={[
          {
            label: "직접 추가",
            pick: () => {
              setScreen("name");
            },
          },
        ]}
      />
      <AuthoringSheets screen={screen} setScreen={setScreen} />
    </>
  );
}
