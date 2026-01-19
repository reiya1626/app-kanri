import { Scenario } from "@/types";

export const demoScenarios: Scenario[] = [
  {
    id: "library-loan",
    title: "図書館の貸出管理システム",
    problemText: `
市立図書館では、会員は本を借りることができます。
1人の会員は同時に複数冊の本を借りてもよいですが、各貸出には「借りた日付」と「返却期限」が記録されます。
同じ本は別の会員に再度貸し出されることもあります。
この状況をもとに、登場する具体的なもの（会員A、本『SQL入門』、貸出記録など）をオブジェクトとして整理し、それらの関係をオブジェクト図として表してください。
    `,
    // 👇 不足していた必須項目を追加
    classProblemText: "",
    objectProblemText: "",
    status: "published",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  },
  {
    id: "clinic-reservation",
    title: "クリニックの予約・診察管理",
    problemText: `
ある小さなクリニックでは、患者は事前に診察予約を取ります。
医師は複数の患者を担当できます。予約には「日時」「担当医」「症状のメモ」が含まれます。
診察が行われると、その内容はカルテとして保存されます。
この状況をもとに、患者・医師・予約・カルテなどをオブジェクトとして整理し、オブジェクト間のつながりをオブジェクト図として表してください。
    `,
    // 👇 こちらにも同様に追加
    classProblemText: "",
    objectProblemText: "",
    status: "published",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  },
];