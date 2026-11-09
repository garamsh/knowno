/**
 * The banned words the 금칙어 tab can import: a clearly-bad subset of an openly licensed Korean
 * list, loaded only by the import action (`screening-terms.ts`), never at build or deploy time and
 * never as an npm dependency.
 *
 * Source: https://github.com/yoonheyjung/badwords-ko, file `src/badwords.ko.config.json`, key
 * `badWords`, at commit 8c9309112407941f94684d2750cd4fb94cf17373. Licence: MIT, Copyright (c) 2015
 * Michael Price; the notice is in `screening-words.license.txt`, next to this file.
 *
 * What was kept: slurs, curses, sexual insults and threats, each written in one compact form,
 * because the server's matcher folds NFKC and ignores case, width and separators, so a variant with
 * a space, dot or hyphen in it is the same term. What was left out: every word that is also an
 * ordinary word or a name in some reading (for example 시발점, 병신년, 십팔, 노무사, 쪽발이,
 * 화냥년, 뒤져라), every slang word that is no more than a mild jibe, and every spelling made of
 * digits or lone jamo. A flashcard note about history or language must not be refused by it.
 *
 * The matcher drops every space and punctuation mark before it looks, so a word is judged as it
 * reads once the separators are gone, and each word kept here was checked that way: none occurs
 * in an ordinary phrase written with spaces (고양이 새끼 became 이새끼, 개 같은 동물 became 개같,
 * 3개년 계획 holds 개년, 죽여 버리고 holds 죽여버리고, 조선 시대의 창녀 and 조센징 name a person
 * or a word of history). 시팔 and 씨팔 sit inside 세 시 팔 분 and 씨 팔아요, and 개새끼 inside "개 새끼", a puppy; the
 * spellings the matcher cannot tell from ordinary text are left to the admin's own list.
 */
export const screeningWords: readonly string[] = [
  "개부랄",
  "븅신",
  "씨발",
  "씨벌",
  "시부럴",
  "씨부럴",
  "쉬발",
  "쉬펄",
  "슈발",
  "슈벌",
  "씹새끼",
  "씹창",
  "씹할",
  "씹팔",
  "좆",
  "좃",
  "좆까",
  "좆팔",
  "지랄",
  "쥐랄",
  "쌍년",
  "쌍놈",
  "썅",
  "쌔끼",
  "호로새끼",
  "빡새끼",
  "계새끼",
  "뒈져",
  "김치녀",
  "된장녀",
  "보슬아치",
  "엠창",
  "느금",
  "니미럴",
  "엠빙신",
];
