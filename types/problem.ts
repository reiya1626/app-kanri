// 教員環境から学習環境へ渡す、現在の問題1件分のデータ
export type ProblemData = {
  id: string;
  title: string;
  objectProblemText: string;
  objectAnswerPuml: string;
  classProblemText?: string;
  classAnswerPuml?: string;
  updatedAt: string;
};

// localStorage などに保存する単位
export type ProblemStore = {
  currentProblem: ProblemData | null;
};