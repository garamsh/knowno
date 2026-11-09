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
 */
export const screeningWords: readonly string[] = [
  "개새끼",
  "개새기",
  "개같",
  "개년",
  "개부랄",
  "븅신",
  "씨발",
  "시팔",
  "씨팔",
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
  "이새끼",
  "새끼야",
  "호로새끼",
  "빡새끼",
  "계새끼",
  "뒈져",
  "죽어버려",
  "죽여버리고",
  "창녀",
  "쪽바리",
  "짱깨",
  "조센징",
  "김치녀",
  "된장녀",
  "보슬아치",
  "엠창",
  "느금",
  "니미럴",
  "엠빙신",
];
